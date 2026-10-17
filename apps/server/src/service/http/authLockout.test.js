import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
import { startTestServer } from "../../testing/testApp.js";
import { LOGIN_THROTTLE } from "./loginThrottle.js";

// The failed-login matrix through the real routes (CC-117). Behind one trusted proxy, X-Forwarded-For says which
// address each attempt comes from, so one test plays the player at home and an attacker somewhere else.
let server;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const RIYA = { username: "Riya", email: "riya@example.com", password: "correct horse battery" };
const HOME = "203.0.113.7";
const ATTACKER = "198.51.100.66";

async function post(path, body, { from = HOME } = {}) {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": from },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const login = (password, options) => post("/api/auth/login", { email: RIYA.email, password }, options);

async function start(failedLogins = {}) {
  server = await startTestServer({
    env: { TRUST_PROXY_HOPS: "1" },
    authLimits: {
      perIp: { windowMs: 60_000, limit: 1_000 },
      failedLogins: { ...LOGIN_THROTTLE, slowDownMs: 1, ...failedLogins },
    },
  });
  await post("/api/auth/signup", RIYA);
}

describe("failed logins (CC-117)", () => {
  it("refuses an address after five wrong passwords for one email, even with the right one", async () => {
    await start();
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await login("guessing123", { from: ATTACKER })).status);

    const rightPassword = await login(RIYA.password, { from: ATTACKER });

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(rightPassword.status).toBe(429);
    expect(rightPassword.body.error).toEqual(
      expect.objectContaining({
        code: ERROR_CODES.RATE_LIMITED,
        message: "Too many attempts, try again later",
      }),
    );
  });

  it("still lets the real player in from their own address while the attacker is blocked", async () => {
    await start();
    for (let i = 0; i < 6; i++) await login("guessing123", { from: ATTACKER });

    const fromHome = await login(RIYA.password, { from: HOME });

    expect(fromHome.status).toBe(200);
  });

  it("lets the right password in from a new address while many addresses guess, only a little later", async () => {
    await start({ failuresPerEmail: 3, slowDownMs: 200 });
    for (let i = 0; i < 4; i++) await login("guessing123", { from: `198.51.100.${i}` });
    const started = Date.now();

    const fromCafe = await login(RIYA.password, { from: "192.0.2.44" });

    expect(fromCafe.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });

  it("does not count a successful login as a failure", async () => {
    await start({ failuresPerEmailAndAddress: 1 });

    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await login(RIYA.password)).status);

    expect(statuses).toEqual([200, 200, 200]);
  });

  it("counts a login whose email is not text against that address, without naming any account", async () => {
    await start({ failuresPerEmailAndAddress: 2 });
    const attempt = () =>
      post("/api/auth/login", { email: 12345, password: "guessing123" }, { from: ATTACKER });

    const statuses = [(await attempt()).status, (await attempt()).status, (await attempt()).status];

    expect(statuses).toEqual([401, 401, 429]);
    expect((await login(RIYA.password, { from: ATTACKER })).status).toBe(200);
  });

  it("does not count a login that failed because storage failed", async () => {
    const accounts = createInMemoryAccountDao();
    let broken = false;
    const accountDao = {
      ...accounts,
      getByEmail: async (email) => {
        if (broken) throw new Error("database down");
        return accounts.getByEmail(email);
      },
    };
    server = await startTestServer({
      env: { TRUST_PROXY_HOPS: "1" },
      accountDao,
      authLimits: { failedLogins: { ...LOGIN_THROTTLE, failuresPerEmailAndAddress: 1 } },
    });
    await post("/api/auth/signup", RIYA);
    broken = true;

    const failed = await login(RIYA.password);
    broken = false;

    expect(failed.status).toBe(500);
    expect((await login(RIYA.password)).status).toBe(200);
  });

  it("answers an unknown email the same way as a wrong password, and blocks it the same way", async () => {
    await start({ failuresPerEmailAndAddress: 1 });
    const unknown = () =>
      post("/api/auth/login", { email: "nobody@example.com", password: "guessing123" }, { from: ATTACKER });

    const first = await unknown();
    const second = await unknown();

    expect(first.status).toBe(401);
    expect(second.status).toBe(429);
  });
});
