import mongoose from "mongoose";
import { io as connect } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { flagPaths } from "./testing/flagPaths.js";
import { startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { testConfig } from "./testing/testConfig.js";

// Friends through the real composition root, real MongoDB (in memory) and real HTTP and WebSocket (CC-052,
// ADR-066). The four new collections get their indexes at boot, a block ends a friendship before it answers, and
// deleting an account erases its friends data on both sides.
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

async function start({ invites = false } = {}) {
  const config = testConfig({ MONGO_URI: mongo.uri(`friends-${++dbCounter}`) });
  // The owner's rollout, as the console stores it: read at boot (CC-312).
  if (invites) {
    await withDatabase(config.mongoUri, (db) =>
      db
        .collection("feature_flags")
        .insertOne({ name: "friend_invites", rollout: "on", updatedAt: new Date() }),
    );
  }
  const capture = captureLogger();
  onTestFailed(() => capture.entries.forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`)));
  const app = await startServer({ config, logger: capture.logger });
  return { ...app, config, url: `http://127.0.0.1:${app.port}` };
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
    body: text === "" ? {} : JSON.parse(text),
    cookie: setCookie?.split(";")[0] ?? cookie,
  };
}

const send = (socket, event, payload) => socket.timeout(2_000).emitWithAck(event, payload);

async function account(url, username) {
  const res = await call(url, "POST", "/auth/signup", {
    body: { username, email: `${username}@example.com`, password: PASSWORD, birthYear: 1990 },
  });
  expect(res.status).toBe(201);
  const socket = connect(url, {
    transports: ["websocket"],
    extraHeaders: { cookie: res.cookie },
    reconnection: false,
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return { cookie: res.cookie, socket };
}

describe("friends through the real composition root (integration, CC-052)", () => {
  it("builds the friends indexes, ends a friendship when one blocks the other, and erases it all on deletion", async () => {
    const app = await start();
    const sockets = [];
    try {
      const uri = app.config.mongoUri;
      const riya = await account(app.url, "riya");
      const arjun = await account(app.url, "arjun");
      sockets.push(riya.socket, arjun.socket);
      const { data: created } = await send(riya.socket, SOCKET_EVENTS.ROOM_CREATE, {
        gameId: "rps",
        options: { bestOf: 1 },
      });
      const { data: joined } = await send(arjun.socket, SOCKET_EVENTS.ROOM_JOIN, { code: created.code });
      const seatOf = (view, seatId) => ({
        roomCode: view.code,
        seat: view.seats.findIndex((seat) => seat.playerId === seatId),
        seatId,
      });
      const arjunSeat = seatOf(joined, joined.you);
      const riyaSeat = seatOf(joined, joined.hostId);

      expect(
        (await call(app.url, "POST", "/friends/requests", { body: arjunSeat, cookie: riya.cookie })).body,
      ).toEqual({
        result: "sent",
      });
      expect(
        (await call(app.url, "POST", "/friends/requests", { body: riyaSeat, cookie: arjun.cookie })).body,
      ).toEqual({
        result: "friends",
      });
      const friendships = await withDatabase(uri, (db) => db.collection("friendships").find().toArray());
      expect(friendships).toHaveLength(1);
      const indexes = await withDatabase(uri, async (db) =>
        Object.fromEntries(
          await Promise.all(
            ["friendships", "friend_requests", "friend_links", "player_privacy"].map(async (name) => [
              name,
              (await db.collection(name).indexes()).map((index) => index.key),
            ]),
          ),
        ),
      );
      expect(indexes).toEqual({
        friendships: expect.arrayContaining([{ low: 1, high: 1 }, { high: 1 }]),
        friend_requests: expect.arrayContaining([{ senderId: 1, recipientId: 1 }, { expiresAt: 1 }]),
        friend_links: expect.arrayContaining([{ tokenHash: 1 }, { expiresAt: 1 }]),
        player_privacy: expect.arrayContaining([{ playerId: 1 }]),
      });

      // Riya blocks Arjun from his seat: the friendship is gone before the block answers.
      const blocked = await call(app.url, "POST", "/blocks", { body: arjunSeat, cookie: riya.cookie });
      expect(blocked.status).toBe(200);
      expect(await withDatabase(uri, (db) => db.collection("friendships").countDocuments())).toBe(0);
      expect((await call(app.url, "GET", "/friends", { cookie: arjun.cookie })).body.friends).toEqual([]);

      // Arjun makes a link and switches Appear offline, then deletes his account: nothing of his is left.
      await call(app.url, "POST", "/friends/links", { cookie: arjun.cookie });
      await call(app.url, "PUT", "/friends/settings", {
        body: { appearOffline: true },
        cookie: arjun.cookie,
      });
      const deleted = await call(app.url, "POST", "/account/delete", {
        body: { password: PASSWORD },
        cookie: arjun.cookie,
      });
      expect(deleted.status).toBe(204);
      const left = await withDatabase(uri, async (db) =>
        Promise.all(
          ["friendships", "friend_requests", "friend_links", "player_privacy"].map((name) =>
            db.collection(name).countDocuments(),
          ),
        ),
      );
      expect(left).toEqual([0, 0, 0, 0]);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      await app.close();
    }
  });
  flagPaths("friend_invites", (on) => {
    it("wires invites to friends in the composition root: a friend by handle, the group stored (CC-052 part 2)", async () => {
      const app = await start({ invites: on });
      const sockets = [];
      try {
        const riya = await account(app.url, "riya");
        const arjun = await account(app.url, "arjun");
        sockets.push(riya.socket, arjun.socket);
        const { data: created } = await send(riya.socket, SOCKET_EVENTS.ROOM_CREATE, {
          gameId: "rps",
          options: { bestOf: 1 },
        });
        const { data: joined } = await send(arjun.socket, SOCKET_EVENTS.ROOM_JOIN, { code: created.code });
        const seatOf = (seatId) => ({
          roomCode: joined.code,
          seat: joined.seats.findIndex((seat) => seat.playerId === seatId),
          seatId,
        });
        await call(app.url, "POST", "/friends/requests", { body: seatOf(joined.you), cookie: riya.cookie });
        await call(app.url, "POST", "/friends/requests", {
          body: seatOf(joined.hostId),
          cookie: arjun.cookie,
        });
        const [friend] = (await call(app.url, "GET", "/friends", { cookie: riya.cookie })).body.friends;
        const pushed = new Promise((resolve) => arjun.socket.once(SOCKET_EVENTS.CHALLENGE_UPDATED, resolve));

        const made = await call(app.url, "POST", "/challenges", {
          body: { gameId: "rps", to: { handle: friend.handle } },
          cookie: riya.cookie,
        });

        if (!on) {
          expect(made.status).toBe(404);
          return;
        }
        expect(made.status).toBe(201);
        expect((await pushed).challenge).toMatchObject({ forYou: true, toOne: true, fromName: "riya" });
        const [stored] = await withDatabase(app.config.mongoUri, (db) =>
          db.collection("challenges").find().toArray(),
        );
        expect(stored).toMatchObject({ toName: "arjun", groupId: made.body.challenge.id });
      } finally {
        sockets.forEach((socket) => socket.disconnect());
        await app.close();
      }
    });
  });
});
