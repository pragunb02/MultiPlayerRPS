import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { io as connect } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { SESSION_COLLECTION } from "./persistence/sessionStore.js";
import { startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { testConfig } from "./testing/testConfig.js";

// Account deletion, data export and birth years through the real composition root, real MongoDB (in memory), and
// real HTTP and WebSocket (CC-035, CC-152). Every store of docs/DATA.md is read back directly after a deletion.
let mongo;
let dbCounter = 0;

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

async function withDatabase(uri, work) {
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    return await work(connection.db);
  } finally {
    await connection.close();
  }
}
const readCollection = (uri, name, filter = {}) =>
  withDatabase(uri, (db) => db.collection(name).find(filter).toArray());

async function eventually(probe, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function start() {
  const config = testConfig({ MONGO_URI: mongo.uri(`account-data-${++dbCounter}`) });
  const capture = captureLogger();
  onTestFailed(() => capture.entries.forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`)));
  const app = await startServer({ config, logger: capture.logger });
  return { ...app, ...capture, config, url: `http://127.0.0.1:${app.port}` };
}

const PASSWORD = "correct horse battery";

async function call(url, method, path, { body, cookie } = {}) {
  const res = await fetch(`${url}/api${path}`, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: text === "" ? {} : JSON.parse(text),
    cookie: setCookie ? setCookie.split(";")[0] : cookie,
  };
}

async function socketFor(url, cookie) {
  const socket = connect(url, { transports: ["websocket"], extraHeaders: { cookie }, reconnection: false });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

const send = (socket, event, payload) => socket.timeout(2_000).emitWithAck(event, payload);

async function playRps(winner, loser) {
  const { data: room } = await send(winner.socket, SOCKET_EVENTS.ROOM_CREATE, {
    gameId: "rps",
    options: { bestOf: 1 },
  });
  await send(loser.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
  await send(winner.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "rock" } });
  await send(loser.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "scissors" } });
  return room.code;
}

describe("account deletion through the real composition root (integration, CC-035)", () => {
  it("deletes or anonymises every store for the account, and the opponent keeps the shared games", async () => {
    const app = await start();
    const sockets = [];
    try {
      const uri = app.config.mongoUri;
      const signup = (username, extra = {}, cookie) =>
        call(app.url, "POST", "/auth/signup", {
          body: { username, email: `${username}@example.com`, password: PASSWORD, ...extra },
          cookie,
        });
      const samUp = await signup("sam", { birthYear: 1990 });
      const sam = { cookie: samUp.cookie, id: samUp.body.identity.id };
      sam.socket = await socketFor(app.url, sam.cookie);
      sockets.push(sam.socket);

      // Riya plays first as a guest, then signs up, so a guest transfer and a guest marker exist.
      const guest = await call(app.url, "POST", "/session/guest");
      const riyaGuest = { cookie: guest.cookie, socket: await socketFor(app.url, guest.cookie) };
      sockets.push(riyaGuest.socket);
      await playRps(riyaGuest, sam);
      await eventually(async () => {
        const { body } = await call(app.url, "GET", "/progress", { cookie: guest.cookie });
        return body.progress.matchesPlayed === 1 ? true : undefined;
      });
      // The guest is on the boards before signing up (ADR-060), so deletion must find those rows too.
      await eventually(async () =>
        (await readCollection(uri, "leaderboard_entries", { playerId: guest.body.identity.id })).length > 0
          ? true
          : undefined,
      );
      const riyaUp = await signup("riya", { birthYear: 1995 }, guest.cookie);
      expect(riyaUp.status).toBe(201);
      const riya = { cookie: riyaUp.cookie, id: riyaUp.body.identity.id };
      riya.socket = await socketFor(app.url, riya.cookie);
      sockets.push(riya.socket);
      await playRps(riya, sam);
      const phone = await call(app.url, "POST", "/auth/login", {
        body: { email: "riya@example.com", password: PASSWORD },
      });
      // A waiting room of her own and a running game against Sam.
      const { data: waiting } = await send(riya.socket, SOCKET_EVENTS.ROOM_CREATE, {
        gameId: "rps",
        options: { bestOf: 1 },
      });
      const { data: running } = await send(sam.socket, SOCKET_EVENTS.ROOM_CREATE, {
        gameId: "rps",
        options: { bestOf: 1 },
      });
      await send(riya.socket, SOCKET_EVENTS.ROOM_JOIN, { code: running.code });
      await eventually(async () =>
        (await readCollection(uri, "leaderboard_entries", { playerId: riya.id })).length > 0
          ? true
          : undefined,
      );
      await eventually(async () =>
        (await readCollection(uri, "player_achievements", { playerId: riya.id })).length > 0
          ? true
          : undefined,
      );

      const refused = await call(app.url, "POST", "/account/delete", {
        body: { password: "not it" },
        cookie: riya.cookie,
      });
      expect(refused.status).toBe(400);
      expect(refused.body.error.details).toEqual({ field: "password" });
      expect(await readCollection(uri, "accounts", { username: "riya" })).toHaveLength(1);

      const disconnected = new Promise((resolve) => riya.socket.once("disconnect", resolve));
      const deleted = await call(app.url, "POST", "/account/delete", {
        body: { password: PASSWORD },
        cookie: riya.cookie,
      });
      expect(deleted.status).toBe(204);
      await disconnected;

      // The forfeited game is recorded for Sam with the stand-in, and only then is everything checked.
      const samMatches = await eventually(async () => {
        const { body } = await call(app.url, "GET", "/matches", { cookie: sam.cookie });
        return body.matches.length === 3 ? body.matches : undefined;
      });
      expect(samMatches.flatMap((m) => m.players.map((p) => p.displayName)).sort()).toEqual([
        "Deleted player",
        "Deleted player",
        "Deleted player",
        "sam",
        "sam",
        "sam",
      ]);
      expect(samMatches.map((m) => m.outcomeForYou).sort()).toEqual(["loss", "loss", "win"]);

      // Neither her account id nor the guest id she played under before signing up may be left anywhere.
      const guestId = guest.body.identity.id;
      const mentions = (docs) =>
        docs.filter((doc) => JSON.stringify(doc).includes(riya.id) || JSON.stringify(doc).includes(guestId));
      for (const name of [
        "accounts",
        SESSION_COLLECTION,
        "rooms",
        "matches",
        "player_progress",
        "player_stats",
        "player_achievements",
        "player_quests",
        "leaderboard_entries",
        "player_transfers",
        "pending_matches",
        "chess_ratings",
      ]) {
        expect({ name, left: mentions(await readCollection(uri, name)) }).toEqual({ name, left: [] });
      }
      expect(JSON.stringify(await readCollection(uri, "matches"))).not.toContain(`"riya"`);
      expect(JSON.stringify(await readCollection(uri, "pending_matches"))).not.toContain(`"riya"`);
      // The outbox still has every game, the running one finished under the stand-in included.
      expect((await readCollection(uri, "pending_matches")).length).toBeGreaterThanOrEqual(3);
      expect(await readCollection(uri, "accounts", { email: "riya@example.com" })).toEqual([]);
      expect(await readCollection(uri, "player_transfers")).toEqual([]);
      expect(await readCollection(uri, "player_progress", { mergedInto: riya.id })).toEqual([]);
      expect(await readCollection(uri, "account_deletions")).toEqual([
        expect.objectContaining({
          playerId: riya.id,
          requestedAt: expect.any(Date),
          expiresAt: expect.any(Date),
        }),
      ]);
      expect((await readCollection(uri, "rooms", { code: waiting.code })).length).toBe(0);
      expect(
        (await call(app.url, "GET", "/leaderboards/overall", { cookie: sam.cookie })).body.entries.map(
          (e) => e.displayName,
        ),
      ).toEqual(["sam"]);

      // Every device is signed out, and the account is gone for good.
      expect((await call(app.url, "GET", "/session", { cookie: phone.cookie })).body).toEqual({
        authenticated: false,
      });
      expect(deleted.headers.get("set-cookie")).toContain("cc.sid=;");
      const login = await call(app.url, "POST", "/auth/login", {
        body: { email: "riya@example.com", password: PASSWORD },
      });
      expect(login.status).toBe(401);
      const again = await signup("riya");
      expect(again.status).toBe(201);
      expect(again.body.identity.id).not.toBe(riya.id);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      await app.close();
    }
  }, 30_000);

  it("closes the legacy row without writing to it, so the old password cannot bring the account back", async () => {
    const app = await start();
    try {
      const uri = app.config.mongoUri;
      const legacy = {
        username: "Sam Lee",
        email: "Sam@Example.com",
        password: bcrypt.hashSync("old password 1", 4),
        level: 3,
      };
      await withDatabase(uri, (db) => db.collection("users").insertOne(legacy));
      const before = await readCollection(uri, "users");
      const migrated = await call(app.url, "POST", "/auth/login", {
        body: { email: "sam@example.com", password: "old password 1" },
      });
      expect(migrated.status).toBe(200);

      const deleted = await call(app.url, "POST", "/account/delete", {
        body: { password: "old password 1" },
        cookie: migrated.cookie,
      });

      expect(deleted.status).toBe(204);
      expect(await readCollection(uri, "users")).toEqual(before);
      expect(await readCollection(uri, "legacy_closures")).toEqual([
        expect.objectContaining({ legacyId: String(before[0]._id) }),
      ]);
      const relogin = await call(app.url, "POST", "/auth/login", {
        body: { email: "sam@example.com", password: "old password 1" },
      });
      expect(relogin.status).toBe(401);
      const fresh = await call(app.url, "POST", "/auth/signup", {
        body: { username: "SamAgain", email: "sam@example.com", password: PASSWORD },
      });
      expect(fresh.status).toBe(201);
    } finally {
      await app.close();
    }
  });
});

describe("data export and birth year through the real composition root (integration, CC-035, CC-152)", () => {
  it("exports the account's own data as a JSON download, and nobody else's id", async () => {
    const app = await start();
    const sockets = [];
    try {
      const riyaUp = await call(app.url, "POST", "/auth/signup", {
        body: { username: "riya", email: "riya@example.com", password: PASSWORD, birthYear: 2001 },
      });
      const samUp = await call(app.url, "POST", "/auth/signup", {
        body: { username: "sam", email: "sam@example.com", password: PASSWORD },
      });
      const riya = { cookie: riyaUp.cookie, socket: await socketFor(app.url, riyaUp.cookie) };
      const sam = { cookie: samUp.cookie, socket: await socketFor(app.url, samUp.cookie) };
      sockets.push(riya.socket, sam.socket);
      await playRps(riya, sam);
      await eventually(async () =>
        (await readCollection(app.config.mongoUri, "leaderboard_entries")).length >= 2 ? true : undefined,
      );

      const exported = await call(app.url, "POST", "/account/export", {
        body: { password: PASSWORD },
        cookie: riya.cookie,
      });

      expect(exported.status).toBe(200);
      expect(exported.headers.get("content-disposition")).toMatch(
        /^attachment; filename="?classicade-data-\d{4}-\d{2}-\d{2}\.json"?$/,
      );
      expect(exported.headers.get("cache-control")).toBe("no-store");
      expect(exported.body.account).toEqual({
        username: "riya",
        email: "riya@example.com",
        createdAt: expect.any(String),
        birthYear: 2001,
        ageGroup: "adult",
      });
      expect(exported.body.matches).toHaveLength(1);
      expect(exported.body.matches[0].players).toEqual([
        { player: "you", displayName: "riya" },
        { player: "player-2", displayName: "sam" },
      ]);
      expect(exported.body.progress).toEqual(expect.objectContaining({ xp: expect.any(Number), wins: 1 }));
      expect(exported.body.leaderboards.length).toBeGreaterThan(0);
      expect(JSON.stringify(exported.body)).not.toContain(samUp.body.identity.id);
      expect(JSON.stringify(exported.body)).not.toContain(riyaUp.body.identity.id);

      // Sam stated no year: on the public board his name is hidden, Riya's shows.
      const board = await call(app.url, "GET", "/leaderboards/overall");
      expect(board.body.entries.map((e) => e.displayName)).toEqual(["riya", "Hidden player"]);
      const set = await call(app.url, "PUT", "/account/birth-year", {
        body: { birthYear: 1980 },
        cookie: sam.cookie,
      });
      expect(set.body.account).toEqual(expect.objectContaining({ birthYear: 1980, ageGroup: "adult" }));
      expect((await readCollection(app.config.mongoUri, "accounts", { username: "sam" }))[0].birthYear).toBe(
        1980,
      );
      const after = await call(app.url, "GET", "/leaderboards/overall");
      expect(after.body.entries.map((e) => e.displayName)).toEqual(["riya", "sam"]);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      await app.close();
    }
  }, 20_000);
});

describe("the age policy and the owner's corrections through the real composition root (integration, CC-152)", () => {
  it("serves each player's own flags, and the owner's correction changes them and the profile rule at once", async () => {
    const uri = mongo.uri(`account-data-${++dbCounter}`);
    // The owner's account id is known only after sign-up, so the server starts again with it as the admin.
    const first = await startServer({
      config: testConfig({ MONGO_URI: uri }),
      logger: captureLogger().logger,
    });
    const firstUrl = `http://127.0.0.1:${first.port}`;
    const ownerUp = await call(firstUrl, "POST", "/auth/signup", {
      body: { username: "owner", email: "owner@example.com", password: PASSWORD, birthYear: 1985 },
    });
    await call(firstUrl, "POST", "/auth/signup", {
      body: { username: "sam", email: "sam@example.com", password: PASSWORD, birthYear: 1990 },
    });
    await first.close();

    const capture = captureLogger();
    onTestFailed(() =>
      capture.entries.forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`)),
    );
    const config = testConfig({ MONGO_URI: uri, ADMIN_ACCOUNT_IDS: ownerUp.body.identity.id });
    const app = await startServer({ config, logger: capture.logger });
    const url = `http://127.0.0.1:${app.port}`;
    try {
      const login = (email) => call(url, "POST", "/auth/login", { body: { email, password: PASSWORD } });
      const owner = (await login("owner@example.com")).cookie;
      const sam = (await login("sam@example.com")).cookie;
      const legacyBefore = await readCollection(uri, "users");

      expect((await call(url, "GET", "/safety", { cookie: sam })).body.safety).toEqual(
        expect.objectContaining({ shareCardName: true, publicProfile: true, boardName: "own", emotes: "on" }),
      );
      const guest = await call(url, "POST", "/session/guest");
      expect((await call(url, "GET", "/safety", { cookie: guest.cookie })).body.safety).toEqual(
        expect.objectContaining({
          shareCardName: false,
          friendsMode: "none",
          quietHours: expect.any(Object),
        }),
      );

      const correction = { email: "sam@example.com", birthYear: 2010 };
      const bySam = await call(url, "PUT", "/admin/accounts/birth-year", { body: correction, cookie: sam });
      expect(bySam.status).toBe(404);

      const byOwner = await call(url, "PUT", "/admin/accounts/birth-year", {
        body: correction,
        cookie: owner,
      });
      expect(byOwner.status).toBe(200);
      expect(byOwner.body.account).toEqual({ username: "sam", birthYear: 2010, ageGroup: "minor" });

      expect((await call(url, "GET", "/safety", { cookie: sam })).body.safety).toEqual(
        expect.objectContaining({
          shareCardName: false,
          publicProfile: false,
          boardName: "hidden",
          emotes: "off",
        }),
      );
      const goPublic = await call(url, "PUT", "/profile/visibility", {
        body: { visibility: "public" },
        cookie: sam,
      });
      expect(goPublic.status).toBe(403);
      const [stored] = await readCollection(uri, "accounts", { username: "sam" });
      expect(stored.birthYear).toBe(2010);
      expect(stored.birthYearCorrectedAt).toBeInstanceOf(Date);
      expect(await readCollection(uri, "users")).toEqual(legacyBefore);
      // The player's export says the owner corrected the year, and when.
      const exported = await call(url, "POST", "/account/export", {
        body: { password: PASSWORD },
        cookie: sam,
      });
      expect(exported.body.account).toEqual(
        expect.objectContaining({
          birthYear: 2010,
          birthYearCorrectedAt: stored.birthYearCorrectedAt.toISOString(),
          ageGroup: "minor",
        }),
      );
      const line = capture.entries.find((entry) => entry.msg === "birth year corrected by the owner");
      expect(line).toEqual(expect.objectContaining({ adminId: ownerUp.body.identity.id }));
      expect(JSON.stringify(line)).not.toMatch(/2010|sam@example\.com/);
    } finally {
      await app.close();
    }
  }, 30_000);
});
