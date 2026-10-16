import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, send } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const RIYA = { username: "Riya", email: "riya@example.com", password: "correct horse battery" };

async function post(path, body, cookie) {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie && { cookie }) },
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, body: await res.json(), cookie: setCookie ? setCookie.split(";")[0] : cookie };
}

const whoAmI = async (cookie) =>
  (await fetch(`${server.baseUrl}/api/session`, { headers: { cookie } })).json();

describe("auth routes", () => {
  it("signs a new user up and in, with a hardened session cookie", async () => {
    server = await startTestServer();

    const res = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(RIYA),
    });
    const { identity } = await res.json();

    expect(res.status).toBe(201);
    expect(identity).toEqual({
      kind: "user",
      id: expect.stringMatching(/^user_[0-9a-f]{24}$/),
      displayName: "Riya",
    });
    expect(res.headers.get("set-cookie")).toMatch(/cc\.sid=.*HttpOnly.*SameSite=Lax/i);
    expect(JSON.stringify(identity)).not.toMatch(/email|password|hash/i);
  });

  it("logs back in to the same identity, and GET /api/session knows who you are", async () => {
    server = await startTestServer();
    const signedUp = await post("/api/auth/signup", RIYA);

    const loggedIn = await post("/api/auth/login", { email: "RIYA@example.com", password: RIYA.password });

    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.identity).toEqual(signedUp.body.identity);
    expect((await whoAmI(loggedIn.cookie)).identity).toEqual(signedUp.body.identity);
  });

  it("answers every failed login the same way", async () => {
    server = await startTestServer();
    await post("/api/auth/signup", RIYA);

    const wrongPassword = await post("/api/auth/login", { email: RIYA.email, password: "not the password" });
    const unknownEmail = await post("/api/auth/login", {
      email: "nobody@example.com",
      password: RIYA.password,
    });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual(
        expect.objectContaining({ code: ERROR_CODES.UNAUTHORIZED, message: "Invalid email or password" }),
      );
    }
  });

  it.each([
    [{ ...RIYA, username: "x" }, 400, "username"],
    [{ ...RIYA, password: "short" }, 400, "password"],
    [{ ...RIYA, isAdmin: true }, 400, undefined],
  ])("validates signup input (%#)", async (body, status, field) => {
    server = await startTestServer();

    const res = await post("/api/auth/signup", body);

    expect(res.status).toBe(status);
    if (field) {
      expect(res.body.error.details).toEqual({ field });
    }
  });

  it("refuses a taken username (case-insensitive) with 409", async () => {
    server = await startTestServer();
    await post("/api/auth/signup", RIYA);

    const res = await post("/api/auth/signup", { ...RIYA, username: "RIYA", email: "other@example.com" });

    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ field: "username" });
  });

  it("turns a guest's sockets into the user's: old-session sockets are disconnected on sign-in", async () => {
    server = await startTestServer();
    const guest = await clients.player();
    const disconnected = new Promise((resolve) => guest.socket.once("disconnect", resolve));

    const signedUp = await post("/api/auth/signup", RIYA, guest.cookie);

    expect(await disconnected).toBe("io server disconnect");
    expect(signedUp.cookie).not.toBe(guest.cookie); // new session id: no fixation
    const userSocket = await clients.openSocket(signedUp.cookie);
    expect((await send(userSocket, SOCKET_EVENTS.IDENTITY_GET)).data).toEqual(signedUp.body.identity);
    expect(await whoAmI(guest.cookie)).toEqual({ authenticated: false }); // the old session is gone
  });

  it("a guest who signs up from a room keeps their seat, and the friend sees the new name (CC-083)", async () => {
    server = await startTestServer();
    const guest = await clients.player();
    const friend = await clients.player();
    const created = await send(guest.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "race",
      options: { target: 3 },
    });
    const code = created.data.code;

    const signedUp = await post("/api/auth/signup", RIYA, guest.cookie);
    const userSocket = await clients.openSocket(signedUp.cookie);
    const rejoined = await send(userSocket, SOCKET_EVENTS.ROOM_JOIN, { code });
    const joined = await send(friend.socket, SOCKET_EVENTS.ROOM_JOIN, { code });

    expect(rejoined.data.you).toBe(signedUp.body.identity.id);
    expect(rejoined.data.seats).toEqual([
      { playerId: signedUp.body.identity.id, displayName: "Riya", connected: true },
    ]);
    expect(joined.data.status).toBe("playing"); // the account against the friend, not against the old guest seat
    expect(joined.data.seats.map((seat) => seat.displayName)).toEqual(["Riya", friend.identity.displayName]);
  });

  it("rate-limits failed logins per email, even across different IPs", async () => {
    server = await startTestServer({
      authLimits: {
        perIp: { windowMs: 60_000, limit: 100 },
        failedLoginsPerEmail: { windowMs: 60_000, limit: 2 },
      },
    });
    await post("/api/auth/signup", RIYA);
    const attempt = () => post("/api/auth/login", { email: RIYA.email, password: "guessing123" });

    const statuses = [(await attempt()).status, (await attempt()).status, (await attempt()).status];
    const otherAccount = await post("/api/auth/login", {
      email: "someone@example.com",
      password: "guessing123",
    });

    expect(statuses).toEqual([401, 401, 429]);
    expect(otherAccount.status).toBe(401); // the limit is per email, not global
  });

  it("does not count successful logins against the per-email limit", async () => {
    server = await startTestServer({
      authLimits: {
        perIp: { windowMs: 60_000, limit: 100 },
        failedLoginsPerEmail: { windowMs: 60_000, limit: 1 },
      },
    });
    await post("/api/auth/signup", RIYA);

    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push((await post("/api/auth/login", { email: RIYA.email, password: RIYA.password })).status);
    }

    expect(results).toEqual([200, 200, 200]);
  });

  it("rate-limits signups and logins per IP", async () => {
    server = await startTestServer({
      authLimits: {
        perIp: { windowMs: 60_000, limit: 2 },
        failedLoginsPerEmail: { windowMs: 60_000, limit: 100 },
      },
    });

    await post("/api/auth/signup", { ...RIYA, username: "one", email: "1@example.com" });
    await post("/api/auth/signup", { ...RIYA, username: "two", email: "2@example.com" });
    const third = await post("/api/auth/signup", { ...RIYA, username: "three", email: "3@example.com" });

    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it("never logs passwords or emails", async () => {
    server = await startTestServer();

    await post("/api/auth/signup", RIYA);
    await post("/api/auth/login", { email: RIYA.email, password: "wrong password here" });

    const logs = JSON.stringify(server.entries);
    expect(logs).not.toContain(RIYA.password);
    expect(logs).not.toContain("wrong password here");
    expect(logs).not.toContain(RIYA.email);
  });
});
