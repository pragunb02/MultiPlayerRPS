import { io as connect } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import { ERROR_CODES, ROOM_CLOSE_REASONS, SOCKET_EVENTS } from "@classicade/shared";
import { startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { makeServerDatabase } from "./testing/serverDatabase.js";
import { testConfig } from "./testing/testConfig.js";

// CC-101: a deploy, a crash or the hosting plan putting the server to sleep restarts the process. Rooms live in
// MongoDB, so players come back to the same room and the same game, with the same clocks.
let mongo;
// Every test runs on the same database, emptied first, so a server start makes no collections or indexes
// after the first one (CC-338, as in server.integration.test.js, CC-336).
const DB = "restart";
const cleanups = [];

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

/** One server process: the same database and port across restarts, like the hosting platform. */
function serverProcess({ now, rooms } = {}) {
  let config = testConfig({ MONGO_URI: mongo.uri(DB) });
  let running;
  const logs = [];
  onTestFailed(() => logs.forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`)));

  async function start() {
    const capture = captureLogger();
    logs.push(...capture.entries);
    running = await startServer({
      config,
      logger: capture.logger,
      ...(now && { now }),
      ...(rooms && { rooms }),
    });
    config = testConfig({ MONGO_URI: config.mongoUri, PORT: String(running.port) });
    return running;
  }

  cleanups.push(() => running?.close());
  return {
    start,
    url: () => `http://127.0.0.1:${running.port}`,
    /** Stops the process the way a deploy does (a graceful close). The database stays. */
    async stop() {
      const stopped = running;
      running = undefined;
      await stopped.close();
    },
    /** Stops the process and starts a new one on the same port and database. */
    async restart() {
      await this.stop();
      return start();
    },
  };
}

/** A guest whose socket reconnects by itself, like the browser's, and rejoins `code` after every connect. */
async function guest(server) {
  const res = await fetch(`${server.url()}/api/session/guest`, { method: "POST" });
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const { identity } = await res.json();
  const socket = connect(server.url(), {
    transports: ["websocket"],
    extraHeaders: { cookie },
    reconnectionDelay: 50,
    reconnectionDelayMax: 100,
  });
  cleanups.push(() => socket.disconnect());
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return { socket, identity, cookie };
}

const send = (socket, event, payload) => socket.timeout(3_000).emitWithAck(event, payload);

/** Resolves with the ack of joining `code` again, the next time the socket connects (what the web app does). */
const rejoinOnReconnect = (socket, code) =>
  new Promise((resolve) =>
    socket.once("connect", () => resolve(send(socket, SOCKET_EVENTS.ROOM_JOIN, { code }))),
  );

describe("rooms survive a server restart (integration, CC-101)", () => {
  it("continues a game of Rock Paper Scissors after a restart in the middle of it", async () => {
    const server = serverProcess();
    await server.start();
    const alice = await guest(server);
    const bob = await guest(server);
    const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "rps",
      options: { bestOf: 3 },
    });
    const { data: joined } = await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
    await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "rock" } });

    const aliceBack = rejoinOnReconnect(alice.socket, room.code);
    const bobBack = rejoinOnReconnect(bob.socket, room.code);
    await server.restart();
    const [aliceJoin, bobJoin] = await Promise.all([aliceBack, bobBack]);

    expect(aliceJoin).toEqual(expect.objectContaining({ ok: true }));
    expect(bobJoin.data.status).toBe("playing");
    // The seat ids are the ones from before the restart (CC-253).
    expect(bobJoin.data.seats.map((seat) => seat.playerId)).toEqual([room.you, joined.you]);
    // Alice's hidden choice is still waiting for Bob's.
    const moved = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, {
      code: room.code,
      move: { choice: "scissors" },
    });
    expect(moved.ok).toBe(true);
    expect(moved.data.game.view.rounds).toHaveLength(1);
  });

  it("keeps a rematch request and the series across a restart", async () => {
    const server = serverProcess();
    await server.start();
    const alice = await guest(server);
    const bob = await guest(server);
    const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "rps",
      options: { bestOf: 1 },
    });
    await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
    await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "rock" } });
    await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "scissors" } });
    await send(alice.socket, SOCKET_EVENTS.ROOM_REQUEST, { code: room.code, type: "rematch" });

    const bobBack = rejoinOnReconnect(bob.socket, room.code);
    const aliceBack = rejoinOnReconnect(alice.socket, room.code);
    await server.restart();
    const bobJoin = await bobBack;
    await aliceBack;

    expect(bobJoin.data.status).toBe("finished");
    expect(bobJoin.data.rematch).toEqual(expect.objectContaining({ available: true }));
    expect(bobJoin.data.requests).toEqual([
      expect.objectContaining({ type: "rematch", from: room.you, state: "open" }),
    ]);
    const accepted = await send(bob.socket, SOCKET_EVENTS.ROOM_ANSWER, {
      code: room.code,
      type: "rematch",
      answer: "accept",
    });
    expect(accepted.data.status).toBe("playing");
    expect(accepted.data.series).toEqual({ games: 1, wins: { [room.you]: 1 } });
  });

  it("keeps a challenge and its link across a restart, and it can be taken after (CC-139)", async () => {
    const server = serverProcess();
    await server.start();
    const alice = await guest(server);
    const api = (path, cookie, body) =>
      fetch(`${server.url()}/api${path}`, {
        method: body === undefined && !path.endsWith("/accept") ? "GET" : "POST",
        headers: { cookie, ...(body !== undefined && { "Content-Type": "application/json" }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }).then(async (res) => ({ status: res.status, body: await res.json() }));
    const made = await api("/challenges", alice.cookie, { gameId: "chess", options: {} });

    await server.restart();
    const bob = await guest(server);
    const seen = await api(`/challenges/${made.body.challenge.id}`, bob.cookie);
    const taken = await api(`/challenges/${made.body.challenge.id}/accept`, bob.cookie);

    expect(seen.body.challenge).toMatchObject({ state: "open", gameId: "chess" });
    expect(taken.status).toBe(200);
    expect(taken.body.room.gameId).toBe("chess");
  });

  it("shows who is really connected after a restart: nobody, until they come back", async () => {
    const server = serverProcess();
    await server.start();
    const alice = await guest(server);
    const bob = await guest(server);
    const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "tictactoe",
      options: {},
    });
    await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });

    bob.socket.io.reconnection(false);
    const aliceBack = rejoinOnReconnect(alice.socket, room.code);
    await server.restart();
    const aliceJoin = await aliceBack;

    expect(aliceJoin.data.seats.map((seat) => seat.connected)).toEqual([true, false]);
  });

  /** Alice hosts chess and Bob joins. Answers who plays White and who plays Black. */
  async function chessGame(server, timeControl) {
    const alice = await guest(server);
    const bob = await guest(server);
    const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "chess",
      options: { timeControl },
    });
    const { data: started } = await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
    const whiteId = Object.keys(started.game.view.colors).find((id) => started.game.view.colors[id] === "w");
    // Views name players by seat id (CC-253): Alice's is the `you` of her own view.
    const [white, black] = whiteId === room.you ? [alice, bob] : [bob, alice];
    const whiteSeat = whiteId;
    const move = (player, from, to) =>
      send(player.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { type: "move", from, to } });
    return { code: room.code, white, black, whiteSeat, move };
  }

  it("keeps chess clocks running from the stored times while the server is down", async () => {
    let time = Date.UTC(2026, 9, 16, 12, 0, 0);
    const server = serverProcess({ now: () => time });
    await server.start();
    const { code, white, black, move } = await chessGame(server, "rapid-10+0");
    await move(white, "e2", "e4");
    time += 10_000;
    await move(black, "e7", "e5");

    // White thinks for 50 seconds, and the server is down for 40 of them.
    time += 10_000;
    const whiteBack = rejoinOnReconnect(white.socket, code);
    const blackBack = rejoinOnReconnect(black.socket, code);
    await server.stop();
    time += 40_000;
    await server.start();
    const view = (await whiteBack).data.game.view;
    await blackBack;
    const moved = await move(white, "g1", "f3");

    expect(view.clocks).toEqual({ w: 600_000, b: 590_000 });
    expect(moved.data.game.view.clocks).toEqual({ w: 550_000, b: 590_000 });
  });

  it("applies a flag that fell while the server was down as soon as it is back", async () => {
    let time = Date.UTC(2026, 9, 16, 12, 0, 0);
    const server = serverProcess({ now: () => time });
    await server.start();
    const { code, white, black, whiteSeat, move } = await chessGame(server, "bullet-1+0");
    await move(white, "e2", "e4");

    const blackBack = rejoinOnReconnect(black.socket, code);
    await server.stop();
    time += 2 * 60_000; // Black's minute ran out while nobody could reach the server.
    await server.start();
    const { data } = await blackBack;

    expect(data.status).toBe("finished");
    expect(data.game.outcome).toEqual(expect.objectContaining({ winners: [whiteSeat], reason: "timeout" }));
  });

  // PR #67 review: the idle limit of a turn ran on while the server was down, so a player lost for it at startup.
  it("starts the turn of a Tic-Tac-Toe game again when the server is back, however long it was down", async () => {
    let time = Date.UTC(2026, 9, 16, 12, 0, 0);
    const server = serverProcess({ now: () => time });
    await server.start();
    const alice = await guest(server);
    const bob = await guest(server);
    const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "tictactoe",
      options: {},
    });
    const code = room.code;
    const { data: started } = await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code });
    const byId = { [room.you]: alice, [started.you]: bob };
    const first = byId[started.game.activePlayers[0]];
    const second = first === alice ? bob : alice;
    await send(first.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { cell: 0 } });
    time += 1_000;
    await send(second.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { cell: 4 } });

    // The first player is due. The server goes down, and stays down far longer than the minute a turn has.
    const firstBack = rejoinOnReconnect(first.socket, code);
    const secondBack = rejoinOnReconnect(second.socket, code);
    await server.stop();
    time += 10 * 60_000;
    await server.start();
    const resumedAt = time;
    const { data } = await firstBack;
    await secondBack;

    expect(data.status).toBe("playing");
    expect(data.game.turnEndsAt).toBeGreaterThanOrEqual(resumedAt + 60_000);
    const moved = await send(first.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { cell: 1 } });
    expect(moved.ok).toBe(true);
  });

  it("says why a room is gone when someone comes back after it closed", async () => {
    let time = Date.UTC(2026, 9, 16, 12, 0, 0);
    const server = serverProcess({ now: () => time, rooms: { sweepIntervalMs: 20 } });
    await server.start();
    const alice = await guest(server);
    const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "rps",
      options: {},
    });
    const closed = new Promise((resolve) => alice.socket.once(SOCKET_EVENTS.ROOM_CLOSED, resolve));

    time += 31 * 60_000; // nobody joined for longer than a waiting room lives
    await closed;
    await server.restart();
    const again = await guest(server);
    const join = await send(again.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });

    expect(join.error).toEqual(
      expect.objectContaining({
        code: ERROR_CODES.GONE,
        details: { reason: ROOM_CLOSE_REASONS.EXPIRED, gameId: "rps", closedAt: time },
      }),
    );
  });
});
