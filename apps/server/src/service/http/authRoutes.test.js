import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, send } from "../../testing/socketClients.js";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
import { startTestServer } from "../../testing/testApp.js";
import { createPasswordHasher } from "../../utils/passwordHasher.js";

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

  it("refuses a username that starts like a player id with 400, as a reserved name (CC-304)", async () => {
    server = await startTestServer();

    const res = await post("/api/auth/signup", { ...RIYA, username: "user_bob" });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(
      expect.objectContaining({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "That name is reserved. Please choose another name.",
        details: { field: "username" },
      }),
    );
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

    // The seat is named by the account's seat id in this room, never by a player id (CC-253).
    expect(rejoined.data.you).not.toBe(created.data.you);
    expect(rejoined.data.seats).toEqual([
      expect.objectContaining({ playerId: rejoined.data.you, displayName: "Riya", connected: true }),
    ]);
    expect(JSON.stringify(joined.data)).not.toContain(signedUp.body.identity.id);
    expect(joined.data.status).toBe("playing"); // the account against the friend, not against the old guest seat
    expect(joined.data.seats.map((seat) => seat.displayName)).toEqual(["Riya", friend.identity.displayName]);
  });

  it("signing out gives up the seat in a waiting room, so the next person on that browser isn't seated against it (CC-085)", async () => {
    server = await startTestServer();
    const guest = await clients.player();
    const { data } = await send(guest.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "race",
      options: { target: 3 },
    });

    const res = await fetch(`${server.baseUrl}/api/session`, {
      method: "DELETE",
      headers: { cookie: guest.cookie },
    });
    const next = await clients.player();
    const rejoin = await send(next.socket, SOCKET_EVENTS.ROOM_JOIN, { code: data.code });

    expect(res.status).toBe(204);
    expect(rejoin.ok).toBe(false);
    // The room closed when its only player left, and the answer says so.
    expect(rejoin.error).toEqual(
      expect.objectContaining({
        code: ERROR_CODES.GONE,
        details: expect.objectContaining({ reason: "empty" }),
      }),
    );
  });

  it("refuses a JSON body that is an array, not an object", async () => {
    server = await startTestServer();

    const res = await post("/api/auth/login", []);

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(
      expect.objectContaining({ code: ERROR_CODES.VALIDATION_FAILED, message: "Send a JSON object" }),
    );
  });

  it("rate-limits signups and logins per IP", async () => {
    server = await startTestServer({
      authLimits: { perIp: { windowMs: 60_000, limit: 2 } },
    });

    await post("/api/auth/signup", { ...RIYA, username: "one", email: "1@example.com" });
    await post("/api/auth/signup", { ...RIYA, username: "two", email: "2@example.com" });
    const third = await post("/api/auth/signup", { ...RIYA, username: "three", email: "3@example.com" });

    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it("limits sign-ups per address on their own, so a list of emails cannot be checked quickly (CC-118)", async () => {
    server = await startTestServer({ authLimits: { signupPerIp: { windowMs: 60_000, limit: 2 } } });
    await post("/api/auth/signup", { ...RIYA, username: "one", email: "1@example.com" });
    await post("/api/auth/signup", { ...RIYA, username: "two", email: "2@example.com" });

    const third = await post("/api/auth/signup", { ...RIYA, username: "three", email: "3@example.com" });
    const login = await post("/api/auth/login", { email: "1@example.com", password: RIYA.password });

    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(login.status).toBe(200);
  });

  // A store failing behind a login answers the usual 401, so it says nothing about the email, but it is logged
  // as an error so it is not missed (CC-245).
  it.each([
    ["an unknown email", { email: "nobody@example.com", password: RIYA.password }, 401],
    ["an account with a wrong password", { email: RIYA.email, password: "wrong password!" }, 401],
    ["an account with the right password", { email: RIYA.email, password: RIYA.password }, 200],
  ])("logs a legacy store failure behind a login for %s, without the email", async (_, body, status) => {
    // Read fine at boot and for the sign-up, then the store fails.
    let reads = 0;
    const failing = {
      filter() {
        reads += 1;
        if (reads <= 2) return [];
        throw new Error("legacy store unavailable");
      },
    };
    server = await startTestServer({ legacyUsers: failing });
    expect((await post("/api/auth/signup", RIYA)).status).toBe(201);

    const login = await post("/api/auth/login", body);

    expect(login.status).toBe(status);
    if (status === 401) expect(login.body.error.message).toBe("Invalid email or password");
    const [logged] = server.find("the legacy store failed behind a login");
    expect(logged).toMatchObject({ level: 50, err: { message: "legacy store unavailable" } });
    expect(JSON.stringify(logged)).not.toContain("example.com");
  });

  // Accounts stored under an older email spelling are rewritten at login, and the logs hold no email (CC-245).
  it.each([
    [[], "stored email rewritten to the one spelling", 30],
    [
      ["riya@example.com"],
      "stored email left in an older spelling: another account already has the one spelling",
      40,
    ],
  ])(
    "logs what happened to an old spelling at login, without the email (%#)",
    async (taken, message, level) => {
      const accountDao = createInMemoryAccountDao();
      const hasher = createPasswordHasher({ params: { N: 2 ** 10, r: 8, p: 1 } });
      const passwordHash = await hasher.hash(RIYA.password);
      await accountDao.insert({
        username: "Riya",
        email: "ｒiya@example.com",
        passwordHash,
        createdAt: new Date(),
      });
      for (const email of taken) {
        await accountDao.insert({ username: "Other", email, passwordHash, createdAt: new Date() });
      }
      server = await startTestServer({ accountDao });

      const login = await post("/api/auth/login", { email: "ｒiya@example.com", password: RIYA.password });

      expect(login.status).toBe(200);
      expect(login.body).not.toHaveProperty("emailUpdate");
      const [logged] = server.find(message);
      expect(logged).toMatchObject({ level, playerId: login.body.identity.id });
      expect(JSON.stringify(server.entries)).not.toContain("iya@example.com");
    },
  );

  it("still logs the player in when saving an upgraded hash fails, and logs the failure (CC-260)", async () => {
    const accountDao = {
      ...createInMemoryAccountDao(),
      updatePasswordHash: async () => Promise.reject(new Error("database unavailable")),
    };
    const weak = createPasswordHasher({ params: { N: 2 ** 9, r: 8, p: 1 } });
    await accountDao.insert({
      username: "Riya",
      email: RIYA.email,
      passwordHash: await weak.hash(RIYA.password),
      createdAt: new Date(),
    });
    server = await startTestServer({ accountDao });

    const login = await post("/api/auth/login", { email: RIYA.email, password: RIYA.password });

    expect(login.status).toBe(200);
    const [logged] = server.find("saving the upgraded password hash failed");
    expect(logged).toMatchObject({ level: 40, playerId: login.body.identity.id });
    expect(JSON.stringify(server.entries)).not.toContain(RIYA.email);
  });

  // The bundled list is the real one, and the breach service is a fake fetch, so no test touches the network.
  describe("passwords attackers already know (CC-261)", () => {
    const EASY = "That password is too easy to guess. Choose a different one.";
    // Answers a range that holds the password's own suffix, after checking only its prefix was asked for.
    const breachedRange = async (url) => {
      const sha1 = createHash("sha1").update(RIYA.password).digest("hex").toUpperCase();
      expect(url).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
      return new Response(`${sha1.slice(5)}:12\r\n${"0".repeat(35)}:0`);
    };

    it("refuses a common password at sign-up with 400 at the password field", async () => {
      server = await startTestServer();

      const res = await post("/api/auth/signup", { ...RIYA, password: "password1" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: EASY,
        details: { field: "password" },
      });
    });

    it("refuses a breached password at sign-up, and counts the check without saying whose", async () => {
      const outcomes = [];
      server = await startTestServer({
        pwnedPasswordsFetch: breachedRange,
        metrics: { recordPasswordCheck: (check) => outcomes.push(check) },
      });

      const res = await post("/api/auth/signup", RIYA);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ message: EASY, details: { field: "password" } });
      expect(outcomes).toEqual([{ outcome: "breached" }]);
    });

    it("signs up when the breach service cannot be reached, and counts that", async () => {
      const outcomes = [];
      server = await startTestServer({ metrics: { recordPasswordCheck: (check) => outcomes.push(check) } });

      const res = await post("/api/auth/signup", RIYA);

      expect(res.status).toBe(201);
      expect(outcomes).toEqual([{ outcome: "unavailable" }]);
    });

    it("refuses a common new password on a password change, at the new password field", async () => {
      server = await startTestServer();
      const { cookie } = await post("/api/auth/signup", RIYA);

      const res = await post(
        "/api/auth/password",
        { currentPassword: RIYA.password, newPassword: "Password1" },
        cookie,
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ message: EASY, details: { field: "newPassword" } });
    });
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
