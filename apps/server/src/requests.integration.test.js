import mongoose from "mongoose";
import { io as connect } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { makeServerDatabase } from "./testing/serverDatabase.js";
import { testConfig } from "./testing/testConfig.js";

// Requests and presence through the real composition root, on MongoDB (CC-159, CC-207, CC-158). The owner's
// report: two players finish a game, Alice goes to the home page without pressing Leave, Bob asks for a rematch,
// and Alice never hears of it. Now the request reaches her on any page, and nobody waits forever.
let mongo;
// Every test runs on the same database, emptied first, so a server start makes no collections or indexes
// after the first one (CC-338, as in server.integration.test.js, CC-336).
const DB = "requests";
const cleanups = [];
const MINUTE = 60_000;

beforeAll(async () => {
  mongo = await startMemoryMongo();
  await makeServerDatabase(mongo, DB);
}, 120_000);

beforeEach(async () => {
  await mongo.empty(DB);
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

afterAll(async () => {
  await mongo?.stop();
});

/** A server on its own database whose clock the test moves. It can be restarted on the same port and data. */
function serverProcess() {
  let config = testConfig({ MONGO_URI: mongo.uri(DB) });
  let running;
  const clock = { now: 1_700_000_000_000 };
  const logs = [];
  onTestFailed(() => logs.forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`)));

  async function start() {
    const capture = captureLogger();
    logs.push(...capture.entries);
    running = await startServer({ config, logger: capture.logger, now: () => clock.now });
    config = testConfig({ MONGO_URI: config.mongoUri, PORT: String(running.port) });
    return running;
  }

  /** Reads the database through a separate connection, as an outside observer of what was stored. */
  async function read(query) {
    const connection = await mongoose.createConnection(config.mongoUri).asPromise();
    try {
      return await query(connection.db);
    } finally {
      await connection.close();
    }
  }

  cleanups.push(() => running?.close());
  return {
    clock,
    start,
    url: () => `http://127.0.0.1:${running.port}`,
    async restart() {
      const stopped = running;
      running = undefined;
      await stopped.close();
      return start();
    },
    /** The rooms as stored, read through a separate connection. */
    storedRooms: () => read((db) => db.collection("rooms").find().toArray()),
    /** How many documents a collection holds. */
    count: (name) => read((db) => db.collection(name).countDocuments()),
  };
}

/** A guest with a socket that reconnects by itself, like a browser tab, recording every push it receives. */
async function guest(server) {
  const res = await fetch(`${server.url()}/api/session/guest`, { method: "POST" });
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const { identity } = await res.json();
  return anotherTab(server, { identity, cookie });
}

/** One more tab of a player, on a page that is not a room. */
async function anotherTab(server, { identity, cookie }) {
  const socket = connect(server.url(), {
    transports: ["websocket"],
    extraHeaders: { cookie },
    reconnectionDelay: 50,
    reconnectionDelayMax: 100,
  });
  const received = [];
  socket.onAny((event, payload) => received.push({ event, payload }));
  cleanups.push(() => socket.disconnect());
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return { socket, identity, cookie, received };
}

const send = async (socket, event, payload) => {
  const ack = await socket.timeout(3_000).emitWithAck(event, payload);
  if (!ack.ok) throw new Error(`${event} failed: ${ack.error.message}`);
  return ack.data;
};

/**
 * Waits, for up to twenty seconds, until a push of `event` that passes `test` has arrived, counting only pushes after
 * the first `after` the player received.
 */
async function heard(player, event, test = () => true, { after = 0 } = {}) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const found = player.received.slice(after).find((entry) => entry.event === event && test(entry.payload));
    if (found !== undefined) return found.payload;
    if (Date.now() > deadline) throw new Error(`no ${event} arrived`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const seatOf = (view, player) => view.seats.find((seat) => seat.playerId === player.seatId);

/** Alice hosts best-of-1 Rock Paper Scissors, Bob joins, Alice throws rock and Bob scissors: Alice wins. */
async function finishedGame(server) {
  const alice = await guest(server);
  const bob = await guest(server);
  const { code, you } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
    gameId: "rps",
    options: { bestOf: 1 },
  });
  const joined = await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code });
  // Views name players by seat id (CC-253): each player's is the `you` of their own view.
  alice.seatId = you;
  bob.seatId = joined.you;
  await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "rock" } });
  const done = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "scissors" } });
  expect(done.status).toBe("finished");
  return { alice, bob, code };
}

// Each test starts a server and plays a game over real sockets, which takes a while on a busy machine.
describe("requests and presence through the real composition root (integration)", { timeout: 60_000 }, () => {
  it("reaches a player who went to the home page, and her Accept starts the next game for both", async () => {
    const server = serverProcess();
    await server.start();
    const { alice, bob, code } = await finishedGame(server);

    // Alice opens the home page: her tab stops showing the room, and Bob sees her as away at once.
    await send(alice.socket, SOCKET_EVENTS.ROOM_AWAY, { code });
    await heard(bob, SOCKET_EVENTS.ROOM_UPDATED, (view) => seatOf(view, alice)?.presence === "away");
    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });

    const pushed = await heard(
      alice,
      SOCKET_EVENTS.REQUEST_UPDATED,
      (payload) => payload.requests.length > 0,
    );
    expect(pushed).toEqual({
      code,
      gameId: "rps",
      you: alice.seatId,
      names: { [alice.seatId]: alice.identity.displayName, [bob.seatId]: bob.identity.displayName },
      requests: [
        {
          type: "rematch",
          from: bob.seatId,
          to: alice.seatId,
          createdAt: server.clock.now,
          expiresAt: server.clock.now + MINUTE,
          state: "open",
          endedAt: 0,
        },
      ],
      serverTime: server.clock.now,
    });
    const [stored] = await server.storedRooms();
    // MongoDB keeps the players' ids. Only what goes to a browser names them by seat id (CC-253).
    expect(stored.requests).toEqual([
      { ...pushed.requests[0], from: bob.identity.id, to: alice.identity.id },
    ]);
    expect(stored.dueAt).toBe(server.clock.now + MINUTE);

    await send(alice.socket, SOCKET_EVENTS.ROOM_ANSWER, { code, type: "rematch", answer: "accept" });
    const view = await send(alice.socket, SOCKET_EVENTS.ROOM_JOIN, { code });

    expect(view.status).toBe("playing");
    expect(view.game.number).toBe(2);
    expect((await heard(bob, SOCKET_EVENTS.ROOM_UPDATED, (next) => next.status === "playing")).code).toBe(
      code,
    );
  });

  it("expires a request nobody answers through the deadline sweep, and tells the asker", async () => {
    const server = serverProcess();
    await server.start();
    const { alice, bob, code } = await finishedGame(server);
    alice.socket.disconnect();
    await heard(bob, SOCKET_EVENTS.ROOM_UPDATED, (view) => seatOf(view, alice)?.presence === "offline");
    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });

    server.clock.now += MINUTE;

    const expired = await heard(bob, SOCKET_EVENTS.ROOM_UPDATED, (view) =>
      view.requests.some((request) => request.state === "expired"),
    );
    expect(expired.status).toBe("finished");
    await heard(bob, SOCKET_EVENTS.REQUEST_UPDATED, (payload) =>
      payload.requests.some((request) => request.state === "expired"),
    );
  });

  it("gives up the seat of a player who stays away from a finished room for two minutes", async () => {
    const server = serverProcess();
    await server.start();
    const { alice, bob, code } = await finishedGame(server);
    await send(alice.socket, SOCKET_EVENTS.ROOM_AWAY, { code });

    server.clock.now += 2 * MINUTE;

    const released = await heard(bob, SOCKET_EVENTS.ROOM_UPDATED, (view) => view.seats.length === 1);
    expect(released.rematch).toEqual(
      expect.objectContaining({ available: false, leftName: alice.identity.displayName }),
    );
    expect((await server.storedRooms())[0].seats.map((seat) => seat.playerId)).toEqual([bob.identity.id]);
  });

  // PR #67 review: a popup about a request could stay open forever when no push told the player it had ended.
  const noneOpen = (code) => (payload) =>
    payload.code === code && payload.requests.every((request) => request.state !== "open");

  it("tells a player whose seat was given up that the request to her has gone", async () => {
    const server = serverProcess();
    await server.start();
    const { alice, bob, code } = await finishedGame(server);
    await send(alice.socket, SOCKET_EVENTS.ROOM_AWAY, { code });
    server.clock.now += 1.5 * MINUTE;
    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });
    await heard(alice, SOCKET_EVENTS.REQUEST_UPDATED, (payload) => payload.requests.length > 0);
    const before = alice.received.length;

    server.clock.now += 0.5 * MINUTE;

    await heard(alice, SOCKET_EVENTS.REQUEST_UPDATED, noneOpen(code), { after: before });
    expect((await server.storedRooms())[0].seats.map((seat) => seat.playerId)).toEqual([bob.identity.id]);
  });

  it("tells every tab of the players that the requests of a room that closed have gone", async () => {
    const server = serverProcess();
    await server.start();
    const { alice, bob, code } = await finishedGame(server);
    // Alice keeps the room open in one tab, so her seat stays, and has the home page open in another.
    const homeTab = await anotherTab(server, alice);
    server.clock.now += 30 * MINUTE - 30_000;
    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });
    await heard(homeTab, SOCKET_EVENTS.REQUEST_UPDATED, (payload) => payload.requests.length > 0);
    const before = homeTab.received.length;

    server.clock.now += 30_000;
    const join = await bob.socket.timeout(3_000).emitWithAck(SOCKET_EVENTS.ROOM_JOIN, { code });

    expect(join.error.code).toBe("GONE");
    const cleared = await heard(homeTab, SOCKET_EVENTS.REQUEST_UPDATED, noneOpen(code), { after: before });
    expect(cleared.requests).toEqual([]);
  });

  it("tells a tab that reconnects that a request which ended while it was offline has gone", async () => {
    const server = serverProcess();
    await server.start();
    const { alice, bob, code } = await finishedGame(server);
    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });
    await heard(alice, SOCKET_EVENTS.REQUEST_UPDATED, (payload) => payload.requests.length > 0);
    alice.socket.disconnect();
    await heard(bob, SOCKET_EVENTS.ROOM_UPDATED, (view) => seatOf(view, alice)?.presence === "offline");
    server.clock.now += MINUTE;
    await heard(bob, SOCKET_EVENTS.REQUEST_UPDATED, (payload) =>
      payload.requests.some((request) => request.state === "expired"),
    );
    const before = alice.received.length;

    alice.socket.connect();

    await heard(alice, SOCKET_EVENTS.REQUEST_UPDATED, noneOpen(code), { after: before });
  });

  it("keeps a request through a restart, warns the players first, and pushes it again on reconnecting", async () => {
    const server = serverProcess();
    await server.start();
    const { alice, bob, code } = await finishedGame(server);
    await send(alice.socket, SOCKET_EVENTS.ROOM_AWAY, { code });
    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });
    const before = alice.received.length;

    await server.restart();

    await heard(alice, SOCKET_EVENTS.SERVER_RESTARTING, () => true, { after: before });
    const again = await heard(
      alice,
      SOCKET_EVENTS.REQUEST_UPDATED,
      (payload) => payload.requests[0]?.state === "open",
      { after: before },
    );
    expect(again.requests[0].from).toBe(bob.seatId);
    await send(alice.socket, SOCKET_EVENTS.ROOM_ANSWER, { code, type: "rematch", answer: "accept" });
    expect((await send(alice.socket, SOCKET_EVENTS.ROOM_JOIN, { code })).status).toBe("playing");
  });

  it("aborts a game nobody starts, and records no match", async () => {
    const server = serverProcess();
    await server.start();
    const alice = await guest(server);
    const bob = await guest(server);
    const { code } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "tictactoe",
      options: {},
    });
    await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code });

    server.clock.now += MINUTE;

    const aborted = await heard(alice, SOCKET_EVENTS.ROOM_UPDATED, (view) => view.status === "finished");
    expect(aborted.game.outcome).toEqual({
      status: "finished",
      result: "aborted",
      winners: [],
      reason: "aborted",
    });
    expect(await server.count("matches")).toBe(0);
  });
});
