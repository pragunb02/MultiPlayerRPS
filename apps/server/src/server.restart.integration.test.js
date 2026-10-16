import { io as connect } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import { ERROR_CODES, ROOM_CLOSE_REASONS, SOCKET_EVENTS } from "@classicade/shared";
import { startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { testConfig } from "./testing/testConfig.js";

// CC-101: a deploy, a crash or the hosting plan putting the server to sleep restarts the process. Rooms live in
// MongoDB, so players come back to the same room and the same game, with the same clocks.
let mongo;
let dbCounter = 0;
const cleanups = [];

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

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
  let config = testConfig({ MONGO_URI: mongo.uri(`restart-${++dbCounter}`) });
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
    await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
    await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "rock" } });

    const aliceBack = rejoinOnReconnect(alice.socket, room.code);
    const bobBack = rejoinOnReconnect(bob.socket, room.code);
    await server.restart();
    const [aliceJoin, bobJoin] = await Promise.all([aliceBack, bobBack]);

    expect(aliceJoin).toEqual(expect.objectContaining({ ok: true }));
    expect(bobJoin.data.status).toBe("playing");
    expect(bobJoin.data.seats.map((seat) => seat.playerId)).toEqual([alice.identity.id, bob.identity.id]);
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
    await send(alice.socket, SOCKET_EVENTS.ROOM_REMATCH, { code: room.code });

    const bobBack = rejoinOnReconnect(bob.socket, room.code);
    const aliceBack = rejoinOnReconnect(alice.socket, room.code);
    await server.restart();
    const bobJoin = await bobBack;
    await aliceBack;

    expect(bobJoin.data.status).toBe("finished");
    expect(bobJoin.data.rematch).toEqual(
      expect.objectContaining({ requestedBy: [alice.identity.id], available: true }),
    );
    const accepted = await send(bob.socket, SOCKET_EVENTS.ROOM_REMATCH, { code: room.code });
    expect(accepted.data.status).toBe("playing");
    expect(accepted.data.series).toEqual({ games: 1, wins: { [alice.identity.id]: 1 } });
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
    const [white, black] = whiteId === alice.identity.id ? [alice, bob] : [bob, alice];
    const move = (player, from, to) =>
      send(player.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { type: "move", from, to } });
    return { code: room.code, white, black, move };
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
    const { code, white, black, move } = await chessGame(server, "bullet-1+0");
    await move(white, "e2", "e4");

    const blackBack = rejoinOnReconnect(black.socket, code);
    await server.stop();
    time += 2 * 60_000; // Black's minute ran out while nobody could reach the server.
    await server.start();
    const { data } = await blackBack;

    expect(data.status).toBe("finished");
    expect(data.game.outcome).toEqual(
      expect.objectContaining({ winners: [white.identity.id], reason: "timeout" }),
    );
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
