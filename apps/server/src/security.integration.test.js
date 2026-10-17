import mongoose from "mongoose";
import { io as connect } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import { ERROR_CODES, ROOM_LIMIT_REASONS, SOCKET_EVENTS } from "@classicade/shared";
import { SESSION_COLLECTION } from "./persistence/sessionStore.js";
import { startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { testConfig } from "./testing/testConfig.js";

// The security batch (CC-107, CC-116, CC-117) through the real composition root, with rooms, accounts and sessions
// stored in MongoDB.
let mongo;
let dbCounter = 0;
let app;
const sockets = [];

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect());
  await app?.close();
  app = undefined;
});

const RIYA = { username: "Riya", email: "riya@example.com", password: "correct horse battery" };

async function start(rooms = {}) {
  const capture = captureLogger();
  const config = testConfig({ MONGO_URI: mongo.uri(`security-${++dbCounter}`) });
  onTestFailed(() => capture.entries.forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`)));
  const started = await startServer({ config, logger: capture.logger, rooms });
  app = { ...started, ...capture, config, url: `http://127.0.0.1:${started.port}` };
}

/** Runs `work` on the test's database through its own connection, as an operator would. */
async function withDatabase(work) {
  const connection = await mongoose.createConnection(app.config.mongoUri).asPromise();
  try {
    return await work(connection.db);
  } finally {
    await connection.close();
  }
}

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(`${app.url}${path}`, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  return {
    status: res.status,
    body: text === "" ? {} : JSON.parse(text),
    cookie: setCookie?.split(";")[0] ?? cookie,
  };
}

const whoAmI = async (cookie) => (await call("GET", "/api/session", { cookie })).body;

function openSocket(cookie) {
  const socket = connect(app.url, {
    transports: ["websocket"],
    extraHeaders: { cookie },
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

describe("sessions of an account (integration, CC-116)", () => {
  it("signs out the other device everywhere: its session, its socket and its next connection", async () => {
    await start();
    const laptop = (await call("POST", "/api/auth/signup", { body: RIYA })).cookie;
    const phone = (
      await call("POST", "/api/auth/login", { body: { email: RIYA.email, password: RIYA.password } })
    ).cookie;
    const phoneSocket = await openSocket(phone);
    const phoneCut = new Promise((resolve) => phoneSocket.once("disconnect", resolve));

    expect((await call("POST", "/api/auth/sign-out-others", { cookie: laptop })).status).toBe(204);

    expect(await phoneCut).toBe("io server disconnect");
    const refused = await openSocket(phone).catch((err) => err);
    expect(refused.data).toEqual({ code: ERROR_CODES.UNAUTHORIZED });
    expect(await whoAmI(phone)).toEqual({ authenticated: false });
    expect((await whoAmI(laptop)).authenticated).toBe(true);
    const [account] = await withDatabase((db) => db.collection("accounts").find().toArray());
    expect(account.sessionVersion).toBe(1);
  });

  it("changes the password with production hashing, and only the new one logs in afterwards", async () => {
    await start();
    const laptop = (await call("POST", "/api/auth/signup", { body: RIYA })).cookie;
    const before = await withDatabase((db) => db.collection("accounts").findOne());

    const changed = await call("POST", "/api/auth/password", {
      cookie: laptop,
      body: { currentPassword: RIYA.password, newPassword: "a brand new password" },
    });

    const after = await withDatabase((db) => db.collection("accounts").findOne());
    expect(changed.status).toBe(204);
    expect(after.passwordHash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.sessionVersion).toBe(1);
    const oldLogin = await call("POST", "/api/auth/login", {
      body: { email: RIYA.email, password: RIYA.password },
    });
    const newLogin = await call("POST", "/api/auth/login", {
      body: { email: RIYA.email, password: "a brand new password" },
    });
    expect([oldLogin.status, newLogin.status]).toEqual([401, 200]);
    expect((await whoAmI(laptop)).authenticated).toBe(true);
  });

  it("keeps accounts and sessions made before CC-116 signed in, and starts their 90 days now", async () => {
    await start();
    const cookie = (await call("POST", "/api/auth/signup", { body: RIYA })).cookie;
    await withDatabase(async (db) => {
      await db.collection("accounts").updateMany({}, { $unset: { sessionVersion: "" } });
      await db
        .collection(SESSION_COLLECTION)
        .updateMany({}, { $unset: { "session.sessionVersion": "", "session.signedInAt": "" } });
    });

    const me = await whoAmI(cookie);

    expect(me.authenticated).toBe(true);
    const [stored] = await withDatabase((db) => db.collection(SESSION_COLLECTION).find().toArray());
    expect(stored.session.signedInAt).toEqual(expect.any(Number));
    expect(stored.session.sessionVersion).toBeUndefined();
  });
});

describe("room flood limits with rooms in MongoDB (integration, CC-107)", () => {
  const createRace = (socket) =>
    socket.timeout(2_000).emitWithAck(SOCKET_EVENTS.ROOM_CREATE, { gameId: "rps", options: { bestOf: 1 } });
  const guest = async () => (await call("POST", "/api/session/guest")).cookie;

  it("refuses a fourth waiting room for one player and lets another player create theirs", async () => {
    await start();
    const alice = await openSocket(await guest());
    const bob = await openSocket(await guest());
    for (let i = 0; i < 3; i++) expect((await createRace(alice)).ok).toBe(true);

    const fourth = await createRace(alice);
    const bobs = await createRace(bob);

    expect(fourth.error).toEqual({
      code: ERROR_CODES.CONFLICT,
      message: "You already have 3 rooms waiting; close one first",
      details: { reason: ROOM_LIMIT_REASONS.WAITING_ROOMS, limit: 3 },
    });
    expect(bobs.ok).toBe(true);
  });

  it("answers server busy once MongoDB holds as many rooms as allowed", async () => {
    await start({ limits: { openRoomsMax: 2 } });
    const alice = await openSocket(await guest());
    await createRace(alice);
    await createRace(alice);

    const third = await createRace(await openSocket(await guest()));

    expect(third.error).toEqual({
      code: ERROR_CODES.SERVER_BUSY,
      message: "The server is busy, try again in a minute",
      details: { reason: ROOM_LIMIT_REASONS.SERVER_FULL },
    });
  });
});
