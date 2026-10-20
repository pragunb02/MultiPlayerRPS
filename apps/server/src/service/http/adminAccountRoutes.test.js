import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import { createAccountAccessor } from "../../data/accountAccessor.js";
import { createAccountDeletionAccessor } from "../../data/accountDeletionAccessor.js";
import { createLegacyUserAccessor } from "../../data/legacyUserAccessor.js";
import { createAccountComponent } from "../../domain/accounts/accountComponent.js";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
import { createInMemoryAccountDeletionDao } from "../../testing/inMemoryAccountDeletionDao.js";
import { createInMemoryLegacyUserDao } from "../../testing/inMemoryLegacyUserDao.js";
import { createLegacyPasswordChecker } from "../../utils/legacyPassword.js";
import { createPasswordHasher } from "../../utils/passwordHasher.js";
import { createAdminAccess } from "./adminAccess.js";
import { createAdminAccountRoutes } from "./adminAccountRoutes.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";

const ADMIN = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Owner" };
const GUEST = { kind: "guest", id: "guest_00000000-0000-4000-8000-000000000001", displayName: "Guest-T001" };
const NOW = Date.parse("2026-10-20T06:00:00.000Z");
const RIYA = { username: "Riya", email: "riya@example.com", password: "correct horse battery" };

async function setup() {
  const accountComponent = createAccountComponent({
    accountAccessor: createAccountAccessor({ accountDao: createInMemoryAccountDao() }),
    legacyUserAccessor: createLegacyUserAccessor({ legacyUserDao: createInMemoryLegacyUserDao([]) }),
    passwordHasher: createPasswordHasher({ params: { N: 2 ** 10, r: 8, p: 1 } }),
    legacyPasswords: createLegacyPasswordChecker({ dummyCost: 4 }),
    accountDeletionAccessor: createAccountDeletionAccessor({
      accountDeletionDao: createInMemoryAccountDeletionDao(),
    }),
  });
  const riya = await accountComponent.signup({ ...RIYA, birthYear: 1990, now: NOW });
  const logs = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const who = req.get("X-Test-Identity");
    req.session = who === undefined ? {} : { identity: JSON.parse(who) };
    req.log = { info: (fields, message) => logs.push({ fields, message }), error: () => {} };
    req.id = "test";
    next();
  });
  const { requireAdmin } = createAdminAccess({ adminAccountIds: [ADMIN.id] });
  app.use("/api", createAdminAccountRoutes({ accountComponent, requireAdmin, now: () => NOW }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, logs, accountComponent, riya: riya.identity };
}

const put = (app, body, identity) => {
  const req = request(app).put("/api/admin/accounts/birth-year");
  return (identity === undefined ? req : req.set("X-Test-Identity", JSON.stringify(identity))).send(body);
};

describe("PUT /admin/accounts/birth-year: the owner corrects a year on request (CC-152, ADR-048.9)", () => {
  it("corrects the year of the account with that email and logs who did it, never the year", async () => {
    const { app, logs, accountComponent, riya } = await setup();

    const res = await put(app, { email: RIYA.email, birthYear: 2010 }, ADMIN);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ account: { username: "Riya", birthYear: 2010, ageGroup: "minor" } });
    expect(JSON.stringify(res.body)).not.toContain(riya.id);
    expect(logs).toEqual([
      { fields: { playerId: riya.id, adminId: ADMIN.id }, message: "birth year corrected by the owner" },
    ]);
    expect(JSON.stringify(logs)).not.toContain("2010");
    const groups = await accountComponent.ageGroupsOf({ playerIds: [riya.id], now: NOW });
    expect(groups.get(riya.id)).toBe("minor");
  });

  it("clears the year with null", async () => {
    const { app } = await setup();

    const res = await put(app, { email: RIYA.email, birthYear: null }, ADMIN);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ account: { username: "Riya", ageGroup: "unknown" } });
  });

  it("answers 404 to everyone who is not an admin, as for any unknown address, and changes nothing", async () => {
    const { app, accountComponent, riya } = await setup();
    const player = { kind: "user", id: riya.id, displayName: "Riya" };

    for (const who of [undefined, GUEST, player]) {
      const res = await put(app, { email: RIYA.email, birthYear: 2010 }, who);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
    }
    const groups = await accountComponent.ageGroupsOf({ playerIds: [riya.id], now: NOW });
    expect(groups.get(riya.id)).toBe("adult");
  });

  it("refuses unknown fields, a missing field, an under 13 year and an email with no account", async () => {
    const { app } = await setup();

    const list = await put(app, [RIYA.email, 1990], ADMIN);
    expect(list.status).toBe(400);
    expect(list.body.error.message).toBe("Send a JSON object");
    const extra = await put(app, { email: RIYA.email, birthYear: 1990, playerId: "x" }, ADMIN);
    expect(extra.status).toBe(400);
    expect(extra.body.error.details).toEqual({ fields: ["playerId"] });
    expect((await put(app, { email: RIYA.email }, ADMIN)).status).toBe(400);
    const child = await put(app, { email: RIYA.email, birthYear: 2020 }, ADMIN);
    expect(child.status).toBe(400);
    expect(child.body.error.details).toMatchObject({ field: "birthYear", reason: "too-young" });
    expect((await put(app, { email: "nobody@example.com", birthYear: 1990 }, ADMIN)).status).toBe(404);
  });
});
