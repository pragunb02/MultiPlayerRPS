import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, GAMES } from "@classicade/shared";
import { PRODUCTION_ENV } from "../../testing/testConfig.js";
import { createTestApp } from "../../testing/testApp.js";

const setup = (env) => createTestApp({ env });

describe("HTTP app", () => {
  it("GET /api/health returns ok", async () => {
    const { app } = setup();

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it.each([
    [true, 200, { status: "ok", database: "up" }],
    [false, 503, { status: "unavailable", database: "down" }],
  ])("GET /health reports the database to the hosting platform (up: %s)", async (up, status, body) => {
    const { app } = createTestApp({ isDatabaseUp: () => up });

    const res = await request(app).get("/health");

    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("times every request for operations telemetry by its full route template, never its path", async () => {
    const recorded = [];
    const { app } = createTestApp({ metrics: { recordHttpRequest: (r) => recorded.push(r) } });

    await request(app).get("/api/games");
    await request(app).get("/api/matches/3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    await request(app).get("/room/AB2CDE");

    expect(recorded.map(({ route, method, status }) => [route, method, status])).toEqual([
      ["/api/games", "GET", 200],
      ["/api/matches/:matchId", "GET", 401],
      ["unmatched", "GET", 404],
    ]);
  });

  it("GET /api/games returns the shared catalog", async () => {
    const { app } = setup();

    const res = await request(app).get("/api/games");

    expect(res.status).toBe(200);
    expect(res.body.games).toEqual(GAMES);
  });

  it("sets security headers and hides the framework", async () => {
    const { app } = setup();

    const res = await request(app).get("/api/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("trusts as many proxies as TRUST_PROXY_HOPS says, one by default in production and none elsewhere", () => {
    expect(setup(PRODUCTION_ENV).app.get("trust proxy")).toBe(1);
    expect(setup({ ...PRODUCTION_ENV, TRUST_PROXY_HOPS: "2" }).app.get("trust proxy")).toBe(2);
    expect(setup().app.get("trust proxy")).toBe(false);
  });

  it("logs the proxy trust once at startup, without any address", () => {
    const { find } = setup({ ...PRODUCTION_ENV, TRUST_PROXY_HOPS: "2" });

    expect(find("client addresses read through trusted proxies")).toEqual([
      expect.objectContaining({ level: 30, trustProxyHops: 2 }),
    ]);
  });

  it("tags every response with a request id and logs it", async () => {
    const { app, find } = setup();

    const res = await request(app).get("/api/health");

    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(find("request completed")[0]).toEqual(
      expect.objectContaining({ requestId: res.headers["x-request-id"], status: 200, path: "/api/health" }),
    );
  });

  describe("error responses", () => {
    it("returns the standard error shape for unknown routes", async () => {
      const { app } = setup();

      const res = await request(app).get("/nope");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: ERROR_CODES.NOT_FOUND, message: "Not found", requestId: res.headers["x-request-id"] },
      });
    });

    it("rejects malformed JSON with 400 and a fixed message", async () => {
      const { app } = setup();

      const res = await request(app).post("/api/health").set("Content-Type", "application/json").send("{bad");

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual(
        expect.objectContaining({ code: ERROR_CODES.BAD_REQUEST, message: "Malformed request body" }),
      );
    });

    it("rejects bodies over 100kb with 413", async () => {
      const { app } = setup();

      const res = await request(app)
        .post("/api/health")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ blob: "x".repeat(101 * 1024) }));

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    });

    it("records the error code in the access log", async () => {
      const { app, find } = setup();

      await request(app).get("/nope");

      expect(find("request completed")[0]).toEqual(
        expect.objectContaining({ status: 404, errorCode: ERROR_CODES.NOT_FOUND, level: 40 }),
      );
    });
  });

  describe("app-wide API rate limit", () => {
    const PROXY = "172.64.0.1";
    const PLAYER_A = "203.0.113.7";
    const PLAYER_B = "198.51.100.2";
    const tight = (limit, env) => createTestApp({ env, apiLimit: { windowMs: 60_000, limit } });

    it("answers over the budget with the standard 429 body and the rate limit headers", async () => {
      const { app } = tight(2);

      const allowed = await request(app).get("/api/games");
      await request(app).get("/api/games");
      const res = await request(app).get("/api/games");

      expect(allowed.headers["ratelimit-policy"]).toBe("2;w=60");
      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        error: {
          code: ERROR_CODES.RATE_LIMITED,
          message: "Too many requests, try again later",
          requestId: res.headers["x-request-id"],
        },
      });
      expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
      expect(res.headers.ratelimit).toMatch(/^limit=2, remaining=0, reset=\d+$/);
    });

    it("counts players with a session by session, and requests without one by address", async () => {
      const { app } = tight(3);
      const riya = request.agent(app);
      const sam = request.agent(app);
      await riya.post("/api/session/guest"); // No session yet, so this counts by address (1 of 3).
      await sam.post("/api/session/guest"); // Also by address (2 of 3).

      const riyaStatuses = [];
      for (let i = 0; i < 4; i++) {
        riyaStatuses.push((await riya.get("/api/session")).status);
      }
      const samStatus = (await sam.get("/api/session")).status;
      const anonymous = [
        (await request(app).get("/api/games")).status,
        (await request(app).get("/api/games")).status,
      ];

      expect(riyaStatuses).toEqual([200, 200, 200, 429]);
      expect(samStatus).toBe(200);
      expect(anonymous).toEqual([200, 429]);
    });

    it("keys on the real player behind the proxies, whatever they forge on the left", async () => {
      const { app } = tight(1, { ...PRODUCTION_ENV, TRUST_PROXY_HOPS: "2" });
      const from = (...entries) => request(app).get("/api/games").set("X-Forwarded-For", entries.join(", "));

      const a = await from("10.9.9.9", PLAYER_A, PROXY);
      const b = await from(PLAYER_B, PROXY);
      const aForgingB = await from(PLAYER_B, PLAYER_A, PROXY);

      expect([a.status, b.status, aForgingB.status]).toEqual([200, 200, 429]);
    });

    it("keys the stricter route limits on the real player too", async () => {
      const { app } = createTestApp({
        env: { ...PRODUCTION_ENV, TRUST_PROXY_HOPS: "2" },
        guestLimit: { windowMs: 60_000, limit: 1 },
      });
      const guest = (...entries) =>
        request(app)
          .post("/api/session/guest")
          .set("X-Forwarded-Proto", "https")
          .set("X-Forwarded-For", entries.join(", "));

      const first = await guest("10.0.0.1", PLAYER_A, PROXY);
      const forged = await guest("10.0.0.2", PLAYER_A, PROXY);
      const other = await guest(PLAYER_B, PROXY);

      expect([first.status, forged.status, other.status]).toEqual([201, 429, 201]);
    });

    it("keeps the stricter route limit inside the bigger budget", async () => {
      const { app } = createTestApp({
        apiLimit: { windowMs: 60_000, limit: 100 },
        guestLimit: { windowMs: 60_000, limit: 1 },
      });

      await request(app).post("/api/session/guest");
      const res = await request(app).post("/api/session/guest");

      expect(res.status).toBe(429);
      expect(res.headers["ratelimit-policy"]).toBe("1;w=60");
    });

    it("never limits the health checks or the web app", async () => {
      const dist = mkdtempSync(path.join(tmpdir(), "classicade-web-"));
      mkdirSync(path.join(dist, "assets"));
      writeFileSync(
        path.join(dist, "index.html"),
        '<!doctype html><head><title data-server-head>ClassiCade</title></head><div id=root><h1 data-server-body="title"></h1><p data-server-body="description"></p></div>',
      );
      const { app } = tight(1, { WEB_DIST_DIR: dist });
      await request(app).get("/api/games");

      const statuses = [];
      for (const url of ["/health", "/api/health", "/", "/play/rps", "/health", "/api/health", "/"]) {
        statuses.push((await request(app).get(url)).status);
      }
      const api = await request(app).get("/api/games");

      expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200]);
      expect(api.status).toBe(429);
    });
  });
});
