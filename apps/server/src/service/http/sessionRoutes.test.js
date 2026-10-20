import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import { PRODUCTION_ENV } from "../../testing/testConfig.js";
import { createTestApp } from "../../testing/testApp.js";
import { SESSION_COOKIE_NAME } from "./session.js";

const FIRST_GUEST = {
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-000000000001",
  displayName: "Guest-TAAB",
};

const sessionCookie = (res) =>
  res.headers["set-cookie"]?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));

const DAY_MS = 24 * 60 * 60 * 1000;
const expiresOf = (cookie) => Date.parse(/Expires=([^;]+)/.exec(cookie)[1]);

describe("rolling sessions (CC-096)", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps a player who comes back signed in: every visit moves the expiry to 30 days after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 1) });
    const { app } = createTestApp();
    const agent = request.agent(app);
    const created = await agent.post("/api/session/guest");
    const firstExpiry = expiresOf(sessionCookie(created));

    vi.setSystemTime(Date.UTC(2026, 9, 26)); // day 25: past the old 7-day limit, inside 30 days
    const visit = await agent.get("/api/session");

    expect(firstExpiry).toBe(Date.UTC(2026, 9, 1) + 30 * DAY_MS);
    expect(visit.body).toEqual({ authenticated: true, identity: FIRST_GUEST });
    expect(expiresOf(sessionCookie(visit))).toBe(Date.UTC(2026, 9, 26) + 30 * DAY_MS);
  });

  it("forgets a player who stayed away for more than 30 days", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 1) });
    const { app } = createTestApp();
    const agent = request.agent(app);
    await agent.post("/api/session/guest");

    vi.setSystemTime(Date.UTC(2026, 9, 1) + 31 * DAY_MS);

    expect((await agent.get("/api/session")).body).toEqual({ authenticated: false });
  });

  it("still sets no cookie for visitors without a session", async () => {
    const { app } = createTestApp();

    expect(sessionCookie(await request(app).get("/api/session"))).toBeUndefined();
  });
});

describe("session routes", () => {
  describe("GET /api/session", () => {
    it("answers 200 'not authenticated' without a session — a first visit is not an error (CC-082)", async () => {
      const { app } = createTestApp();

      const res = await request(app).get("/api/session");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: false });
    });

    it("does not create a session or cookie for anonymous reads", async () => {
      const { app, store } = createTestApp();

      const res = await request(app).get("/api/session");

      expect(sessionCookie(res)).toBeUndefined();
      expect(Object.keys(await allSessions(store))).toHaveLength(0);
    });
  });

  describe("POST /api/session/guest", () => {
    it("creates a guest identity and a hardened session cookie", async () => {
      const { app } = createTestApp();

      const res = await request(app).post("/api/session/guest");

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ identity: FIRST_GUEST });
      const cookie = sessionCookie(res);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).not.toMatch(/Secure/i);
    });

    it("remembers the identity for later requests", async () => {
      const { app } = createTestApp();
      const agent = request.agent(app);

      await agent.post("/api/session/guest");
      const res = await agent.get("/api/session");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: true, identity: FIRST_GUEST });
    });

    it("returns the existing identity instead of creating a second one", async () => {
      const { app } = createTestApp();
      const agent = request.agent(app);

      await agent.post("/api/session/guest");
      const res = await agent.post("/api/session/guest");

      expect(res.status).toBe(200);
      expect(res.body.identity).toEqual(FIRST_GUEST);
    });

    it("ignores any identity the client tries to supply", async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post("/api/session/guest")
        .send({ identity: { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "admin" } });

      expect(res.body.identity).toEqual(FIRST_GUEST);
    });

    it("marks the cookie Secure in production behind a TLS proxy", async () => {
      const { app } = createTestApp({
        env: PRODUCTION_ENV,
      });

      const res = await request(app).post("/api/session/guest").set("X-Forwarded-Proto", "https");

      expect(sessionCookie(res)).toMatch(/Secure/i);
    });

    it("rate-limits guest creation per client", async () => {
      const { app } = createTestApp({ guestLimit: { windowMs: 60_000, limit: 2 } });

      await request(app).post("/api/session/guest");
      await request(app).post("/api/session/guest");
      const res = await request(app).post("/api/session/guest");

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
      expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
    });
  });

  describe("DELETE /api/session", () => {
    it("ends the session, clears the cookie and announces it", async () => {
      const { app, endedSessions, store } = createTestApp();
      const agent = request.agent(app);
      await agent.post("/api/session/guest");
      const [sessionId] = Object.keys(await allSessions(store));

      const res = await agent.delete("/api/session");

      expect(res.status).toBe(204);
      expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(endedSessions).toEqual([sessionId]);
      expect((await agent.get("/api/session")).body).toEqual({ authenticated: false });
    });

    it("is a no-op without a session", async () => {
      const { app, endedSessions } = createTestApp();

      const res = await request(app).delete("/api/session");

      expect(res.status).toBe(204);
      expect(endedSessions).toEqual([]);
    });

    it("gives a new guest a new session id after logging out (no fixation)", async () => {
      const { app } = createTestApp();
      const agent = request.agent(app);
      const first = sessionCookie(await agent.post("/api/session/guest"));
      await agent.delete("/api/session");

      const second = sessionCookie(await agent.post("/api/session/guest"));

      expect(second.split(";")[0]).not.toBe(first.split(";")[0]);
    });
  });

  it("rejects a session whose stored identity was tampered with", async () => {
    const { app, store } = createTestApp();
    const agent = request.agent(app);
    await agent.post("/api/session/guest");
    const [sessionId, data] = Object.entries(await allSessions(store))[0];
    await new Promise((resolve) =>
      store.set(sessionId, { ...data, identity: { ...data.identity, kind: "admin" } }, resolve),
    );

    const res = await agent.get("/api/session");

    expect(res.status).toBe(401);
  });
});

/** @param {import("express-session").MemoryStore} store */
function allSessions(store) {
  return new Promise((resolve, reject) =>
    store.all((err, sessions) => (err ? reject(err) : resolve(sessions ?? {}))),
  );
}
