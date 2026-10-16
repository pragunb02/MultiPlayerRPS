import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import {
  clientIpKey,
  createApiRateLimit,
  createRateLimit,
  DEFAULT_API_LIMIT,
  sessionOrIpKey,
} from "./rateLimits.js";

// A chain as it arrives behind two proxies. The player's browser sends nothing (or a forged entry on the left).
// The first proxy adds the player's address and the second proxy adds the first proxy's address.
const PROXY = "172.64.0.1";
const PLAYER_A = "203.0.113.7";
const PLAYER_B = "198.51.100.2";
const chain = (...entries) => entries.join(", ");

/**
 * A small app with one limited route, behind `hops` trusted proxies.
 *
 * @param {{ hops: number, limiter: import("express").RequestHandler }} options
 */
function appWith({ hops, limiter }) {
  const app = express();
  app.set("trust proxy", hops);
  app.use((req, res, next) => {
    req.id = "request-1";
    next();
  });
  app.get("/limited", limiter, (req, res) => res.json({ ok: true }));
  app.get("/failing", limiter, (req, res) => res.status(401).json({ ok: false }));
  return app;
}

const oneRequest = (options = {}) =>
  createRateLimit({ windowMs: 60_000, limit: 1, message: "Too many requests, try again later", ...options });

describe("clientIpKey", () => {
  it("keys on the address Express found for the request", () => {
    expect(clientIpKey(/** @type {any} */ ({ ip: PLAYER_A }))).toBe(`ip:${PLAYER_A}`);
  });

  it("groups IPv6 addresses of one /56 network, because one connection usually owns the whole block", () => {
    const first = clientIpKey(/** @type {any} */ ({ ip: "2001:db8:abcd:1200::1" }));
    const sameNetwork = clientIpKey(/** @type {any} */ ({ ip: "2001:db8:abcd:12ff::2" }));
    const otherNetwork = clientIpKey(/** @type {any} */ ({ ip: "2001:db8:abcd:1300::1" }));

    expect(sameNetwork).toBe(first);
    expect(otherNetwork).not.toBe(first);
  });
});

describe("sessionOrIpKey", () => {
  it("keys a player with a session on that session", () => {
    const req = { ip: PLAYER_A, sessionID: "session-1", session: { identity: { id: "player-1" } } };

    expect(sessionOrIpKey(/** @type {any} */ (req))).toBe("session:session-1");
  });

  it("keys a request without a signed-in or guest player on its address", () => {
    const req = { ip: PLAYER_A, sessionID: "session-1", session: {} };

    expect(sessionOrIpKey(/** @type {any} */ (req))).toBe(`ip:${PLAYER_A}`);
  });
});

describe("createRateLimit", () => {
  it("answers over the limit with the standard error body, Retry-After and RateLimit headers", async () => {
    const app = appWith({ hops: 0, limiter: oneRequest() });

    const first = await request(app).get("/limited");
    const second = await request(app).get("/limited");

    expect(first.status).toBe(200);
    expect(first.headers["ratelimit-policy"]).toBe("1;w=60");
    expect(first.headers.ratelimit).toMatch(/^limit=1, remaining=0, reset=\d+$/);
    expect(second.status).toBe(429);
    expect(second.body).toEqual({
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message: "Too many requests, try again later",
        requestId: "request-1",
      },
    });
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
    expect(second.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it("leaves the headers to another limiter when asked", async () => {
    const app = appWith({ hops: 0, limiter: oneRequest({ headers: false }) });

    await request(app).get("/limited");
    const res = await request(app).get("/limited");

    expect(res.status).toBe(429);
    expect(res.headers.ratelimit).toBeUndefined();
    expect(res.headers["ratelimit-policy"]).toBeUndefined();
  });

  it("can count only failed requests", async () => {
    const app = appWith({ hops: 0, limiter: oneRequest({ skipSuccessfulRequests: true }) });

    const statuses = [];
    for (const path of ["/limited", "/limited", "/failing", "/failing"]) {
      statuses.push((await request(app).get(path)).status);
    }

    expect(statuses).toEqual([200, 200, 401, 429]);
  });

  it("uses the given key", async () => {
    const app = appWith({ hops: 0, limiter: oneRequest({ keyGenerator: (req) => String(req.query.who) }) });

    expect((await request(app).get("/limited?who=a")).status).toBe(200);
    expect((await request(app).get("/limited?who=b")).status).toBe(200);
    expect((await request(app).get("/limited?who=a")).status).toBe(429);
  });

  describe("behind two trusted proxies", () => {
    const app = () => appWith({ hops: 2, limiter: oneRequest() });

    it("gives each player behind the same proxy their own budget", async () => {
      const limited = app();

      const a = await request(limited).get("/limited").set("X-Forwarded-For", chain(PLAYER_A, PROXY));
      const b = await request(limited).get("/limited").set("X-Forwarded-For", chain(PLAYER_B, PROXY));

      expect([a.status, b.status]).toEqual([200, 200]);
    });

    it("ignores addresses a player forges on the left of the chain", async () => {
      const limited = app();
      const forged = (fake) =>
        request(limited)
          .get("/limited")
          .set("X-Forwarded-For", chain(fake, PLAYER_A, PROXY));

      const first = await forged("10.0.0.1");
      const second = await forged("10.0.0.2");
      const third = await forged(`${PLAYER_B}, 10.0.0.3`);

      expect([first.status, second.status, third.status]).toEqual([200, 429, 429]);
    });
  });

  it("counts every player as the proxy when the hop count is too low (the bug TRUST_PROXY_HOPS fixes)", async () => {
    const limited = appWith({ hops: 1, limiter: oneRequest() });

    const a = await request(limited).get("/limited").set("X-Forwarded-For", chain(PLAYER_A, PROXY));
    const b = await request(limited).get("/limited").set("X-Forwarded-For", chain(PLAYER_B, PROXY));

    expect([a.status, b.status]).toEqual([200, 429]);
  });
});

describe("createApiRateLimit", () => {
  it("allows about 300 requests a minute by default", () => {
    expect(DEFAULT_API_LIMIT).toEqual({ windowMs: 60_000, limit: 300 });
  });

  it("never limits the API health check", async () => {
    const app = express();
    app.use((req, res, next) => {
      req.session = /** @type {any} */ ({});
      next();
    });
    app.use("/api", createApiRateLimit({ windowMs: 60_000, limit: 1 }));
    app.get("/api/health", (req, res) => res.json({ status: "ok" }));
    app.get("/api/games", (req, res) => res.json({ games: [] }));

    const statuses = [];
    for (const path of ["/api/health", "/api/health", "/api/games", "/api/games"]) {
      statuses.push((await request(app).get(path)).status);
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
