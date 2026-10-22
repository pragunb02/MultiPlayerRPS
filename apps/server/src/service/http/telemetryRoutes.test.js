import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { exampleTelemetryEvent } from "@classicade/shared/testing";

/** The web client's batch rhythm (apps/web/src/lib/telemetry/client.js TELEMETRY_BATCH): one every 10 seconds. */
const TELEMETRY_BATCH = { everyMs: 10_000 };
import { createTelemetryAccessor } from "../../data/telemetryAccessor.js";
import { TELEMETRY_LIMITS } from "../../domain/telemetry/telemetryLimits.js";
import { createTelemetryComponent } from "../../domain/telemetry/telemetryComponent.js";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { eventsOf } from "../../testing/telemetryCountDaoContract.js";
import { createInMemoryTelemetryCountDao } from "../../testing/inMemoryTelemetryCountDao.js";
import { createTestApp } from "../../testing/testApp.js";
import { createAdminAccess } from "./adminAccess.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";
import { countServerErrors } from "./errorMiddleware.js";
import {
  createNetworkBudget,
  createServerEvents,
  createTelemetryBodyParser,
  createTelemetryRoutes,
  NO_SERVER_EVENTS,
} from "./telemetryRoutes.js";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
import { NotFoundError } from "../../utils/errors.js";

// CC-175: the door for anonymous usage counts. Always 204, whatever was kept, so the answer says nothing.
const BROWSER =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const BUILD = "0.1.0+abc1234";
const ADMIN = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Owner" };
const PLAYER = { kind: "user", id: "user_000000000000000000000001", displayName: "Riya" };
const ALL = { from: 0, to: Date.UTC(2100, 0), limit: 10_000 };

const batch = (events = [exampleTelemetryEvent("page_viewed")]) => ({ build: BUILD, events });

/** The whole app as production wires it, with telemetry on or off. */
async function wholeApp({ on = true, limits = {} } = {}) {
  const drops = [];
  const testApp = createTestApp({
    telemetryLimits: limits,
    metrics: { recordTelemetryDropped: (drop) => drops.push(drop) },
  });
  if (on) await testApp.flagComponent.setRollout({ name: "telemetry_ingest", rollout: "on" });
  const stored = async () =>
    eventsOf(await createTelemetryAccessor({ telemetryCountDao: testApp.telemetryCountDao }).list(ALL));
  const post = (body, headers = {}) =>
    request(testApp.app)
      .post("/api/telemetry")
      .set({ "User-Agent": BROWSER, ...headers })
      .send(body);
  return { ...testApp, drops, stored, post };
}

/** The routes behind a fake session, for who is asking: the test says so with a header, as JSON. */
function withSession() {
  const dao = createInMemoryTelemetryCountDao();
  const telemetryComponent = createTelemetryComponent({
    telemetryAccessor: createTelemetryAccessor({ telemetryCountDao: dao }),
    serverBuild: "unknown",
  });
  const flagComponent = { isOn: async () => true, recordSuccess: async () => undefined };
  const app = express();
  app.use("/api/telemetry", createTelemetryBodyParser({ maxBytes: 8192, onRejected: () => {} }));
  app.use((req, res, next) => {
    const who = req.get("X-Test-Identity");
    req.session = who === undefined ? {} : { identity: JSON.parse(who) };
    req.log = { info: () => {}, error: () => {} };
    req.id = "test";
    next();
  });
  const adminAccess = createAdminAccess({ adminAccountIds: [ADMIN.id] });
  app.use("/api", createTelemetryRoutes({ telemetryComponent, flagComponent, adminAccess }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  const as = (req, identity) =>
    (identity === undefined ? req : req.set("X-Test-Identity", JSON.stringify(identity))).set(
      "User-Agent",
      BROWSER,
    );
  const stored = async () => eventsOf(await createTelemetryAccessor({ telemetryCountDao: dao }).list(ALL));
  return { app, as, stored, telemetryComponent };
}

describe("POST /api/telemetry (CC-175)", () => {
  // AC-1 (CC-175)
  it("drops a batch with GPC or DNT", async () => {
    const { post, stored, drops } = await wholeApp();

    for (const headers of [{ "Sec-GPC": "1" }, { DNT: "1" }]) {
      const res = await post(batch(), headers);
      expect(res.status).toBe(204);
      expect(res.text).toBe("");
    }

    expect(await stored()).toEqual([]);
    expect(drops).toEqual([
      { reason: "opted_out", count: 1 },
      { reason: "opted_out", count: 1 },
    ]);
  });

  // AC-2 (CC-175)
  it("drops the owner's own events", async () => {
    const { app, as, stored } = withSession();

    expect((await as(request(app).post("/api/telemetry").send(batch()), ADMIN)).status).toBe(204);
    expect(await stored()).toEqual([]);

    expect((await as(request(app).post("/api/telemetry").send(batch()), PLAYER)).status).toBe(204);
    expect(await stored()).toHaveLength(1);
  });

  // AC-4 (CC-175)
  it("applies the size, count and rate limits", async () => {
    const limits = { batches: { windowMs: 60_000, limit: 2 } };
    const { post, stored, drops } = await wholeApp({ limits });
    const event = exampleTelemetryEvent("control_pressed");

    // Over 8 KB: answered at once, nothing read or stored.
    const big = await post(JSON.stringify({ build: BUILD, events: [event], pad: "x".repeat(9000) }), {
      "Content-Type": "text/plain",
    });
    expect(big.status).toBe(204);
    // More than 30 events: dropped whole.
    expect((await post(batch(Array(31).fill(event)))).status).toBe(204);
    expect(await stored()).toEqual([]);
    // The oversized body never reached the limit. The second batch in the window is stored, the third is over it.
    expect((await post(batch([event]))).status).toBe(204);
    expect((await post(batch([event]))).status).toBe(204);
    expect(await stored()).toHaveLength(1);

    expect(drops).toEqual([
      { reason: "invalid", count: 1 },
      { reason: "invalid", count: 31 },
      { reason: "rate_limited", count: 1 },
    ]);
  });

  it("counts batches per session when there is one, and allows far more than a client ever sends", async () => {
    expect(TELEMETRY_LIMITS.batches.limit).toBeGreaterThanOrEqual(
      5 * (TELEMETRY_LIMITS.batches.windowMs / TELEMETRY_BATCH.everyMs),
    );
    const { app, stored, post } = await wholeApp({ limits: { batches: { windowMs: 60_000, limit: 1 } } });
    const riya = request.agent(app);
    const arjun = request.agent(app);
    await riya.post("/api/session/guest").expect(201);
    await arjun.post("/api/session/guest").expect(201);
    const send = (agent) => agent.post("/api/telemetry").set("User-Agent", BROWSER).send(batch());

    // Two players behind one network address each have their own budget.
    await send(riya);
    await send(arjun);
    await send(riya);
    // A visitor with no session is counted by the network.
    await post(batch());
    await post(batch());

    await vi.waitFor(async () =>
      expect((await stored()).filter(({ name }) => name === "page_viewed")).toHaveLength(3),
    );
  });

  it("gives one network only a small share of the site's day, and drops the rest as rate_limited", async () => {
    expect(TELEMETRY_LIMITS.perNetworkDaily).toBeLessThanOrEqual(TELEMETRY_LIMITS.storedPerDay / 20);
    const { stored, post, drops } = await wholeApp({ limits: { perNetworkDaily: 3 } });
    const two = batch([exampleTelemetryEvent("page_viewed"), exampleTelemetryEvent("visit_ended")]);

    await post(two);
    await post(two);
    await post(two, { "X-Forwarded-For": "198.51.100.9" });

    expect(await stored()).toHaveLength(3);
    expect(drops).toEqual([
      { reason: "rate_limited", count: 1 },
      { reason: "rate_limited", count: 2 },
    ]);
  });

  flagPaths("telemetry_ingest", (on) => {
    // AC-7 (CC-175)
    it(on ? "stores a batch when the flag is on" : "stores nothing when the flag is off", async () => {
      const { post, stored, drops } = await wholeApp({ on });

      expect((await post(batch())).status).toBe(204);

      expect(await stored()).toHaveLength(on ? 1 : 0);
      expect(drops).toEqual(on ? [] : [{ reason: "flag_off", count: 1 }]);
    });
  });

  it("takes text/plain, as sendBeacon sends it, and stores each event once with only its catalogue fields", async () => {
    const { post, stored } = await wholeApp();
    const events = [exampleTelemetryEvent("control_pressed"), exampleTelemetryEvent("visit_ended")];

    const res = await post(JSON.stringify(batch(events)), { "Content-Type": "text/plain;charset=UTF-8" });

    expect(res.status).toBe(204);
    const kept = await stored();
    // Counters keep no order, so the events are compared as a set.
    expect(
      kept
        .map(({ receivedAt, ...event }) => event)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual(
      events
        .map((event) => ({ ...event, build: BUILD, tier: "counts" }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
  });

  it("drops a known bot or a request with no User-Agent, without storing it", async () => {
    const { post, stored, drops } = await wholeApp();

    await post(batch(), {
      "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    });
    await post(batch(), { "User-Agent": "WhatsApp/2.23.20.0 A" });
    await post(batch(), { "User-Agent": "" });

    expect(await stored()).toEqual([]);
    expect(drops.map(({ reason }) => reason)).toEqual(["bot", "bot", "bot"]);
  });

  it("answers 204 to a body that is not JSON, and stores nothing", async () => {
    const { post, stored, drops } = await wholeApp();

    expect((await post("{not json", { "Content-Type": "text/plain" })).status).toBe(204);
    expect((await post("{not json", { "Content-Type": "application/json" })).status).toBe(204);

    expect(await stored()).toEqual([]);
    expect(drops).toEqual([
      { reason: "invalid", count: 1 },
      { reason: "invalid", count: 1 },
    ]);
  });

  it("still refuses a batch from another site, and text/plain on every other route", async () => {
    const { post, app } = await wholeApp();

    expect((await post(batch(), { Origin: "https://evil.example" })).status).toBe(403);
    const elsewhere = await request(app)
      .post("/api/feedback")
      .set("Content-Type", "text/plain")
      .send(JSON.stringify({ type: "bug" }));
    expect(elsewhere.status).toBe(415);
    const guest = await request(app).post("/api/session/guest").set("Content-Type", "text/plain").send("{}");
    expect(guest.status).toBe(415);
  });
});

describe("the telemetry route's edges (CC-175)", () => {
  it("only POST is a batch: anything else is the usual 404", async () => {
    const { app } = await wholeApp();

    expect((await request(app).get("/api/telemetry")).status).toBe(404);
  });

  it("answers 204 even when the database cannot store the batch, and logs it without the batch", async () => {
    const dao = createInMemoryTelemetryCountDao();
    const failing = { ...dao, addCounts: async () => Promise.reject(new Error("database down")) };
    const testApp = createTestApp({ telemetryCountDao: failing });
    await testApp.flagComponent.setRollout({ name: "telemetry_ingest", rollout: "on" });

    const res = await request(testApp.app).post("/api/telemetry").set("User-Agent", BROWSER).send(batch());

    expect(res.status).toBe(204);
    expect(testApp.find("storing telemetry failed")).toHaveLength(1);
  });
});

describe("telemetry privacy (CC-175, P0)", () => {
  it("no stored event has a player id shape, an email, an address or a room code, whatever a browser sends", async () => {
    const { post, stored } = await wholeApp();
    const sneaky = [
      { ...exampleTelemetryEvent("control_pressed"), player_id: PLAYER.id },
      { ...exampleTelemetryEvent("control_pressed"), control: PLAYER.id },
      { ...exampleTelemetryEvent("control_pressed"), control: "riya@example.com" },
      { ...exampleTelemetryEvent("page_viewed"), route: "/games/chess/rooms/AB2CD3" },
      { ...exampleTelemetryEvent("page_viewed"), ip: "203.0.113.7" },
      { ...exampleTelemetryEvent("request_failed"), endpoint: "/api/matches/m_123" },
      exampleTelemetryEvent("control_pressed"),
    ];

    await post(batch(sneaky), { "X-Forwarded-For": "203.0.113.7" });

    const kept = await stored();
    expect(kept).toHaveLength(1);
    const values = kept.flatMap((event) => Object.values(event)).filter((value) => typeof value === "string");
    expect(values.filter(hasPlayerIdShape)).toEqual([]);
    expect(
      values.filter((value) => /@|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b[A-HJ-NP-Z2-9]{6}\b/.test(value)),
    ).toEqual([]);
    expect(Object.keys(kept[0]).sort()).toEqual(
      [
        "build",
        "control",
        "device",
        "has_reason",
        "name",
        "player_kind",
        "receivedAt",
        "route",
        "tier",
      ].sort(),
    );
  });
});

describe("DELETE /api/admin/telemetry (CC-175)", () => {
  // AC-8 (CC-175)
  it("an admin purges raw events, anyone else gets 404", async () => {
    const { app, as, stored } = withSession();
    await as(request(app).post("/api/telemetry").send(batch()), PLAYER);

    expect((await as(request(app).delete("/api/admin/telemetry?before=2100-01-01"), PLAYER)).status).toBe(
      404,
    );
    expect((await as(request(app).delete("/api/admin/telemetry?before=2100-01-01"), undefined)).status).toBe(
      404,
    );
    expect(await stored()).toHaveLength(1);

    const bad = await as(request(app).delete("/api/admin/telemetry?before=yesterday"), ADMIN);
    expect(bad.status).toBe(400);
    const extra = await as(request(app).delete("/api/admin/telemetry?before=2100-01-01&all=1"), ADMIN);
    expect(extra.status).toBe(400);

    const res = await as(request(app).delete("/api/admin/telemetry?before=2100-01-01"), ADMIN);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ deleted: 1 });
    expect(await stored()).toEqual([]);
  });
});

describe("events the server records itself (CC-175, EVENTS.md 3.3 and 3.5)", () => {
  const names = async (stored) =>
    (await stored()).map(({ name, player_kind: kind, ...rest }) => [name, kind, rest]);
  const credentials = {
    username: "riya_plays",
    email: "riya@example.com",
    password: "a long enough password",
  };

  it("counts a new guest, a sign-up from it, a failed and a good login and a logout, with no id", async () => {
    const { app, stored } = await wholeApp();
    const agent = request.agent(app);

    await agent.post("/api/session/guest").expect(201);
    await agent.post("/api/auth/signup").send(credentials).expect(201);
    await agent.delete("/api/session").expect(204);
    await agent
      .post("/api/auth/login")
      .send({ ...credentials, username: undefined, password: "wrong one!" })
      .expect(401);
    await agent
      .post("/api/auth/login")
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    await vi.waitFor(async () => expect(await stored()).toHaveLength(5));
    const kept = await names(stored);
    expect(
      kept
        .map(([name, kind, rest]) => [name, kind, rest.from_guest ?? rest.cause ?? rest.reason ?? ""])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual(
      [
        ["guest_started", "guest", ""],
        ["account_created", "account", true],
        ["session_ended", "account", "logout"],
        ["login_failed", "visitor", "wrong_credentials"],
        ["login_succeeded", "account", false],
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
    const values = (await stored())
      .flatMap((event) => Object.values(event))
      .filter((v) => typeof v === "string");
    expect(values.filter(hasPlayerIdShape)).toEqual([]);
    expect(values.filter((value) => value.includes("@"))).toEqual([]);
  });

  it("records nothing for a browser whose usage counts switch is off (the X-CC-Counts header)", async () => {
    const { app, stored, post, drops } = await wholeApp();
    const agent = request.agent(app);

    await agent.post("/api/session/guest").set("X-CC-Counts", "off").expect(201);
    await agent
      .post("/api/auth/signup")
      .set("X-CC-Counts", "off")
      .send({ username: "riya_plays", email: "riya@example.com", password: "a long enough password" })
      .expect(201);
    await agent.delete("/api/session").set("X-CC-Counts", "off").expect(204);
    await agent
      .post("/api/auth/login")
      .set("X-CC-Counts", "off")
      .send({ email: "x@example.com", password: "nope nope" });
    expect((await post(batch(), { "X-CC-Counts": "off" })).status).toBe(204);

    // Give a stray write the time to land before saying there is none.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await stored()).toEqual([]);
    expect(drops).toEqual([{ reason: "opted_out", count: 1 }]);
  });

  it("records nothing with GPC, or while the flag is off", async () => {
    const opted = await wholeApp();
    await request(opted.app).post("/api/session/guest").set("Sec-GPC", "1").expect(201);
    const off = await wholeApp({ on: false });
    await request(off.app).post("/api/session/guest").expect(201);

    // Give a stray write the time to land before saying there is none.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await opted.stored()).toEqual([]);
    expect(await off.stored()).toEqual([]);
  });
});

describe("more events the server records (CC-175)", () => {
  const credentials = {
    username: "riya_plays",
    email: "riya@example.com",
    password: "a long enough password",
  };

  it("counts a password change and signing out other devices as ended sessions", async () => {
    const { app, stored } = await wholeApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").send(credentials).expect(201);

    await agent
      .post("/api/auth/password")
      .send({ currentPassword: credentials.password, newPassword: "another long password" })
      .expect(204);
    await agent.post("/api/auth/sign-out-others").expect(204);

    await vi.waitFor(async () => expect(await stored()).toHaveLength(3));
    expect((await stored()).map(({ name, cause }) => [name, cause ?? ""]).sort()).toEqual(
      [
        ["account_created", ""],
        ["session_ended", "password_changed"],
        ["session_ended", "signed_out_elsewhere"],
      ].sort(),
    );
  });

  it("names why a login failed: a field missing, or too many wrong passwords, never which email", async () => {
    const { app, stored } = await wholeApp();

    await request(app)
      .post("/api/auth/login")
      .send({ email: "riya@example.com", password: "x", remember: true })
      .expect(400);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await request(app)
        .post("/api/auth/login")
        .send({ email: "riya@example.com", password: "wrong password!" });
    }

    await vi.waitFor(async () => expect(await stored()).toHaveLength(7));
    const reasons = (await stored()).map(({ reason }) => reason);
    expect(reasons.filter((reason) => reason === "validation")).toHaveLength(1);
    expect(reasons).toContain("wrong_credentials");
    expect(reasons).toContain("throttled");
  });

  it("counts a server fault by its API template and code, never the path", async () => {
    const accountDao = {
      ...createInMemoryAccountDao(),
      insert: async () => {
        throw new Error("the database is down for riya@example.com");
      },
    };
    const testApp = createTestApp({ accountDao });
    await testApp.flagComponent.setRollout({ name: "telemetry_ingest", rollout: "on" });
    const stored = async () =>
      eventsOf(await createTelemetryAccessor({ telemetryCountDao: testApp.telemetryCountDao }).list(ALL));

    await request(testApp.app).post("/api/auth/signup").send(credentials).expect(500);

    await vi.waitFor(async () => expect(await stored()).toHaveLength(1));
    const [event] = await stored();
    expect(event).toMatchObject({ name: "server_errored", operation: "/api/auth/signup", code: "INTERNAL" });
  });

  it("counts only server faults under /api, and passes every error on", () => {
    const recorded = [];
    const count = countServerErrors({ record: (req, name, fields) => recorded.push([name, fields]) });
    const passed = [];
    const next = (err) => passed.push(err);

    count(new NotFoundError("Not found"), { originalUrl: "/api/nothing" }, {}, next);
    count(new Error("boom"), { originalUrl: "/games/chess" }, {}, next);
    count(new Error("boom"), { originalUrl: "/api/matches/m_123?x=1" }, {}, next);

    expect(recorded).toEqual([["server_errored", { operation: "/api/matches/:matchId", code: "INTERNAL" }]]);
    expect(passed).toHaveLength(3);
    expect(NO_SERVER_EVENTS.record()).toBeUndefined();
  });

  it("a failure to record is logged without anything about the player, and never fails the request", async () => {
    const errors = [];
    const events = createServerEvents({
      telemetryComponent: { record: async () => Promise.reject(new Error("database down")) },
      flagComponent: { isOn: async () => true },
      isAdmin: () => false,
    });
    const req = { get: () => undefined, session: {}, log: { error: (fields, line) => errors.push(line) } };

    events.record(req, "guest_started");

    await vi.waitFor(() => expect(errors).toEqual(["recording a telemetry event failed"]));
  });
});

describe("the per-network budget (owner review 2026-10-21)", () => {
  it("lets each network take up to its share of an India day, and starts again the next day", () => {
    let clock = Date.UTC(2026, 9, 20, 10);
    const budget = createNetworkBudget({ limit: 5, now: () => clock });

    expect(budget.take("ip:a", 3)).toBe(3);
    expect(budget.take("ip:a", 3)).toBe(2);
    expect(budget.take("ip:a", 1)).toBe(0);
    expect(budget.take("ip:b", 5)).toBe(5);
    // 18:30 UTC is midnight in India.
    clock = Date.UTC(2026, 9, 20, 18, 31);
    expect(budget.take("ip:a", 4)).toBe(4);
  });
});
