import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import { startTestServer } from "../../testing/testApp.js";
import { createAccountRoutes } from "./accountRoutes.js";

// The account settings routes through the in-process app (CC-035, CC-152). MongoDB is covered by
// accountData.integration.test.js.
let server;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const PASSWORD = "correct horse battery";

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(`${server.baseUrl}/api${path}`, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  return {
    status: res.status,
    body: text === "" ? {} : JSON.parse(text),
    cookie: setCookie ? setCookie.split(";")[0] : cookie,
  };
}

async function signedUp(extra = {}, options = {}) {
  server = await startTestServer(options);
  const res = await call("POST", "/auth/signup", {
    body: { username: "riya", email: "riya@example.com", password: PASSWORD, ...extra },
  });
  return { cookie: res.cookie, identity: res.body.identity };
}

describe("GET /api/account", () => {
  it("answers the player's own account with its age group", async () => {
    const { cookie } = await signedUp({ birthYear: 1999 });

    const res = await call("GET", "/account", { cookie });

    expect(res.status).toBe(200);
    expect(res.body.account).toEqual({
      username: "riya",
      createdAt: expect.any(Number),
      birthYear: 1999,
      ageGroup: "adult",
    });
  });

  it("refuses a visitor with 401 and a guest with 403", async () => {
    server = await startTestServer();
    const guest = await call("POST", "/session/guest");

    expect((await call("GET", "/account")).status).toBe(401);
    expect((await call("GET", "/account", { cookie: guest.cookie })).status).toBe(403);
    expect((await call("POST", "/account/delete", { body: { password: "x" } })).status).toBe(401);
    expect(
      (await call("POST", "/account/export", { body: { password: "x" }, cookie: guest.cookie })).status,
    ).toBe(403);
  });
});

describe("POST /api/auth/signup with a birth year (CC-152)", () => {
  it("refuses a player under 13 at the year field, and creates nothing", async () => {
    server = await startTestServer();

    const res = await call("POST", "/auth/signup", {
      body: {
        username: "kid",
        email: "kid@example.com",
        password: PASSWORD,
        birthYear: new Date().getFullYear(),
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ field: "birthYear", reason: "too-young" });
    expect(
      (await call("POST", "/auth/login", { body: { email: "kid@example.com", password: PASSWORD } })).status,
    ).toBe(401);
  });

  it("refuses a year that is not a whole number from the list", async () => {
    server = await startTestServer();

    const res = await call("POST", "/auth/signup", {
      body: { username: "riya", email: "riya@example.com", password: PASSWORD, birthYear: "1999" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ field: "birthYear" });
  });
});

describe("PUT /api/account/birth-year (CC-152)", () => {
  it("sets the year once and then refuses to change it", async () => {
    const { cookie } = await signedUp();
    expect((await call("GET", "/account", { cookie })).body.account.ageGroup).toBe("unknown");

    const set = await call("PUT", "/account/birth-year", { body: { birthYear: 1990 }, cookie });
    const again = await call("PUT", "/account/birth-year", { body: { birthYear: 2010 }, cookie });

    expect(set.status).toBe(200);
    expect(set.body.account).toEqual(expect.objectContaining({ birthYear: 1990, ageGroup: "adult" }));
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ field: "birthYear" });
  });

  it("refuses unknown fields and a body that is not an object", async () => {
    const { cookie } = await signedUp();

    const extra = await call("PUT", "/account/birth-year", {
      body: { birthYear: 1990, admin: true },
      cookie,
    });
    const list = await call("PUT", "/account/birth-year", { body: [1990], cookie });

    expect(extra.status).toBe(400);
    expect(extra.body.error.details).toEqual({ fields: ["admin"] });
    expect(list.status).toBe(400);
  });
});

describe("POST /api/account/export (CC-035)", () => {
  it("allows 3 exports an hour per account", async () => {
    const { cookie } = await signedUp();

    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await call("POST", "/account/export", { body: { password: PASSWORD }, cookie })).status);
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("stops wrong passwords after 5 in 15 minutes, for export and deletion together", async () => {
    const { cookie } = await signedUp();

    const statuses = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await call("POST", "/account/export", { body: { password: "nope" }, cookie })).status);
      statuses.push((await call("POST", "/account/delete", { body: { password: "nope" }, cookie })).status);
    }

    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
    const blocked = await call("POST", "/account/delete", { body: { password: PASSWORD }, cookie });
    expect(blocked.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect((await call("GET", "/account", { cookie })).status).toBe(200);
  });

  it("uses the limits it is given", async () => {
    const { cookie } = await signedUp({}, { accountLimits: { exports: { windowMs: 60_000, limit: 1 } } });

    await call("POST", "/account/export", { body: { password: PASSWORD }, cookie });

    expect((await call("POST", "/account/export", { body: { password: PASSWORD }, cookie })).status).toBe(
      429,
    );
  });
});

describe("POST /api/account/delete (CC-035)", () => {
  it("ends this session and tells who listens, so every socket of the account is cut", async () => {
    const { cookie, identity } = await signedUp();
    const ended = [];
    server.onAccountDeleted((playerId) => ended.push(playerId));

    const res = await call("POST", "/account/delete", { body: { password: PASSWORD }, cookie });

    expect(res.status).toBe(204);
    expect(ended).toEqual([identity.id]);
    expect(server.endedSessions).toHaveLength(1);
    expect((await call("GET", "/session", { cookie })).body).toEqual({ authenticated: false });
  });

  it("refuses a missing password field", async () => {
    const { cookie } = await signedUp();

    const res = await call("POST", "/account/delete", { body: {}, cookie });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ field: "password" });
  });
});

describe("createAccountRoutes", () => {
  it("fails fast without its dependencies", () => {
    expect(() => createAccountRoutes({})).toThrow(TypeError);
  });
});
