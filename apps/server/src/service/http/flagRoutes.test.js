import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, FLAG_AUDIENCES, FLAG_ROLLOUT } from "@classicade/shared";
import { createFeatureFlagAccessor } from "../../data/featureFlagAccessor.js";
import { createFlagComponent } from "../../domain/flags/flagComponent.js";
import { captureLogger } from "../../testing/captureLogger.js";
import { createInMemoryFeatureFlagDao } from "../../testing/inMemoryFeatureFlagDao.js";
import { createKeyedIds } from "../../utils/keyedIds.js";
import { createAdminAccess } from "./adminAccess.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";
import { createFlagRoutes } from "./flagRoutes.js";

// CC-312: the web app asks for the flags it needs and gets booleans only. The owner sets rollouts in the console,
// behind the allowlist and its 404 (ADR-036).
const ADMIN = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Owner" };
const PLAYER = { kind: "user", id: "user_000000000000000000000001", displayName: "Riya" };
const GUEST = { kind: "guest", id: "guest_00000000-0000-4000-8000-000000000001", displayName: "Guest-T001" };

const flag = (fields) =>
  Object.freeze({
    name: "new_lobby",
    description: "The new lobby.",
    ticket: "CC-400",
    default: false,
    removeBy: "2026-12-31",
    rollout: FLAG_ROLLOUT.OFF,
    audience: FLAG_AUDIENCES.EVERYONE,
    client: true,
    success: "A room is made from the new lobby.",
    ...fields,
  });
const REGISTRY = Object.freeze([
  flag({}),
  flag({ name: "owner_only", audience: FLAG_AUDIENCES.ADMINS, rollout: FLAG_ROLLOUT.ON }),
  flag({ name: "server_only", client: false, rollout: FLAG_ROLLOUT.ON }),
]);

/** The flag routes behind a fake session: the test says who is asking with a header, as JSON. */
function setup() {
  const dao = createInMemoryFeatureFlagDao();
  const flagComponent = createFlagComponent({
    registry: REGISTRY,
    flagAccessor: createFeatureFlagAccessor({ featureFlagDao: dao }),
    keyedIds: createKeyedIds({ secret: "a test key for feature flag buckets, 32+ chars" }),
    safety: { policyFor: async () => ({ audience: "minor" }) },
    logger: captureLogger().logger,
  });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const who = req.get("X-Test-Identity");
    req.session = who === undefined ? {} : { identity: JSON.parse(who) };
    req.log = { info: () => {}, warn: () => {}, error: () => {} };
    req.id = "test";
    next();
  });
  const adminAccess = createAdminAccess({ adminAccountIds: [ADMIN.id] });
  app.use("/api", createFlagRoutes({ flagComponent, adminAccess }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, flagComponent, dao };
}

const as = (req, identity) =>
  identity === undefined ? req : req.set("X-Test-Identity", JSON.stringify(identity));
const get = (app, path, identity) => as(request(app).get(path), identity);
const post = (app, path, identity) => as(request(app).post(path), identity);
const put = (app, path, body, identity) => as(request(app).put(path).send(body), identity);
const remove = (app, path, identity) => as(request(app).delete(path), identity);

describe("GET /api/flags (CC-312)", () => {
  it("answers only booleans, never cached", async () => {
    const { app } = setup();

    const res = await get(app, "/api/flags?names=new_lobby,owner_only", GUEST);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ flags: { new_lobby: false, owner_only: false } });
  });

  it("answers an admin's admin-only flag as on, and a visitor too gets answers", async () => {
    const { app } = setup();

    expect((await get(app, "/api/flags?names=owner_only", ADMIN)).body).toEqual({
      flags: { owner_only: true },
    });
    expect((await get(app, "/api/flags?names=new_lobby")).body).toEqual({ flags: { new_lobby: false } });
  });

  it("follows the owner's rollout at once", async () => {
    const { app, flagComponent } = setup();
    await flagComponent.setRollout({ name: "new_lobby", rollout: "on" });

    expect((await get(app, "/api/flags?names=new_lobby", PLAYER)).body).toEqual({
      flags: { new_lobby: true },
    });
  });

  it.each([
    ["no names", "/api/flags"],
    ["an empty name", "/api/flags?names="],
    ["an unknown name", "/api/flags?names=no_such_flag"],
    ["a server-only flag", "/api/flags?names=server_only"],
    ["a name given twice", "/api/flags?names=new_lobby,new_lobby"],
    ["another query field", "/api/flags?names=new_lobby&bucket=1"],
    ["names given as a list", "/api/flags?names=new_lobby&names=owner_only"],
  ])("refuses %s with 400", async (_, path) => {
    const { app } = setup();

    const res = await get(app, path, GUEST);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe("POST /api/flags/:name/success (CC-312)", () => {
  it("counts one success on the side the server works out, and answers nothing", async () => {
    const { app, flagComponent, dao } = setup();

    const res = await post(app, "/api/flags/new_lobby/success", GUEST);
    await flagComponent.flush();

    expect(res.status).toBe(204);
    expect(await dao.countsSince("2026-01-01")).toEqual([
      { flag: "new_lobby", side: "off", exposures: 0, successes: 1 },
    ]);
  });

  it("refuses an unknown or server-only flag with 400", async () => {
    const { app } = setup();

    expect((await post(app, "/api/flags/no_such_flag/success", GUEST)).status).toBe(400);
    expect((await post(app, "/api/flags/server_only/success", GUEST)).status).toBe(400);
  });
});

describe("the console's flag routes (CC-312)", () => {
  it("lists every flag for an admin, never cached and never listed", async () => {
    const { app } = setup();

    const res = await get(app, "/api/admin/flags", ADMIN);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.body.source).toBe("code");
    expect(res.body.flags.map(({ name }) => name)).toEqual(["new_lobby", "owner_only", "server_only"]);
  });

  it("an admin sets and clears a rollout", async () => {
    const { app } = setup();

    const set = await put(app, "/api/admin/flags/new_lobby", { rollout: 20 }, ADMIN);
    expect(set.status).toBe(200);
    expect(set.body.flag).toEqual(
      expect.objectContaining({ name: "new_lobby", rollout: 20, codeRollout: "off" }),
    );

    const cleared = await remove(app, "/api/admin/flags/new_lobby", ADMIN);
    expect(cleared.status).toBe(200);
    expect(cleared.body.flag.rollout).toBe("off");
    expect(cleared.body.flag).not.toHaveProperty("override");
  });

  it.each([
    ["no body", undefined],
    ["a rollout over 100", { rollout: 101 }],
    ["a rollout as text", { rollout: "50" }],
    ["another field", { rollout: "on", audience: "everyone" }],
    ["a list", [{ rollout: "on" }]],
  ])("refuses %s with 400", async (_, body) => {
    const { app } = setup();

    const res = await put(app, "/api/admin/flags/new_lobby", body, ADMIN);

    expect(res.status).toBe(400);
  });

  it("lists an override left for a removed flag, and an admin clears it", async () => {
    const { app, dao, flagComponent } = setup();
    await dao.setOverride({ name: "removed_flag", rollout: 40, updatedAt: new Date(Date.UTC(2026, 9, 1)) });
    await flagComponent.refresh();

    const listed = await get(app, "/api/admin/flags", ADMIN);
    expect(listed.body.orphans).toEqual([
      { name: "removed_flag", rollout: 40, updatedAt: Date.UTC(2026, 9, 1) },
    ]);

    const cleared = await remove(app, "/api/admin/flags/removed_flag", ADMIN);
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({});
    expect(await dao.listOverrides()).toEqual([]);
  });

  it("answers 404 for a flag that is not in the registry", async () => {
    const { app } = setup();

    expect((await put(app, "/api/admin/flags/no_such_flag", { rollout: "on" }, ADMIN)).status).toBe(404);
    expect((await remove(app, "/api/admin/flags/no_such_flag", ADMIN)).status).toBe(404);
  });

  it.each([
    ["a visitor", undefined],
    ["a guest", GUEST],
    ["an account not on the list", PLAYER],
  ])("anyone but an admin gets 404: %s", async (_, identity) => {
    const { app, dao } = setup();

    for (const res of [
      await get(app, "/api/admin/flags", identity),
      await put(app, "/api/admin/flags/new_lobby", { rollout: "on" }, identity),
      await remove(app, "/api/admin/flags/new_lobby", identity),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
    }
    expect(await dao.listOverrides()).toEqual([]);
  });
});
