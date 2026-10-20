import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

import { Server } from "socket.io";
import { afterEach, describe, expect, it } from "vitest";

import { startTestServer } from "../../apps/server/src/testing/testApp.js";
import { roomLimits } from "../../apps/server/src/domain/rooms/roomLimits.js";
import { ENGINES } from "../../packages/games/src/index.js";
import { createSeededRng } from "../../packages/games/src/rng.js";
import { GAME_IDS, ROOM_STATUS, SOCKET_EVENTS } from "../../packages/shared/src/index.js";
import { DEFAULT_MODEL } from "./model.mjs";
import { createRecorder } from "./stats.mjs";
import { createSwarm } from "./swarm.mjs";

// The swarm against the real server stack (rooms, engines, computer players, the match pipeline) with in-memory
// storage, so the harness is known to play whole games before it is pointed at the Docker build (CC-289). Players
// think for a little over 100 ms, so they stay inside the event budget of 10 a second that every player has.
const ORIGIN = "http://localhost:5173";
const OPEN = { windowMs: 60_000, limit: 1_000_000 };
const QUICK = Object.freeze({
  ...DEFAULT_MODEL,
  computerShare: 0.5,
  thinkMs: Object.freeze({
    [GAME_IDS.RPS]: { min: 120, max: 200 },
    [GAME_IDS.TIC_TAC_TOE]: { min: 120, max: 200 },
    [GAME_IDS.CHESS]: { min: 120, max: 200 },
  }),
  resultMs: { min: 120, max: 200 },
  rematchShare: 0.5,
  chessOwnMoves: { min: 1, max: 4 },
});

const cleanups = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()();
});

async function realServer(limits = {}) {
  const server = await startTestServer({
    engines: ENGINES,
    guestLimit: OPEN,
    apiLimit: OPEN,
    roomLimits: roomLimits({ socketsPerAddress: 100_000, openRoomsPerAddress: 100_000, ...limits }),
  });
  cleanups.push(() => server.close());
  return server;
}

function swarmOn(base, options = {}) {
  const recorder = createRecorder();
  const swarm = createSwarm({
    base,
    origin: ORIGIN,
    recorder,
    rng: createSeededRng(1),
    model: QUICK,
    ...options,
  });
  cleanups.push(() => swarm.stop());
  return { recorder, swarm };
}

/**
 * A stand-in server for the ways a real one can let a player down. `guest` answers the sign-in, `admit` decides the
 * socket handshake and `handlers` answer the events (an event without a handler is never answered).
 */
async function fakeServer({
  guest = (res) => res.writeHead(200, { "set-cookie": "cc.sid=s1; Path=/" }).end(),
  admit,
  handlers = {},
}) {
  const httpServer = http.createServer((req, res) => guest(res));
  const io = new Server(httpServer);
  if (admit) io.use(admit);
  io.on("connection", (socket) => {
    for (const [event, handler] of Object.entries(handlers)) {
      socket.on(event, (payload, ack) => handler({ socket, payload, ack }));
    }
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => io.close(resolve)));
  return `http://127.0.0.1:${httpServer.address().port}`;
}

const waitingRoom = { code: "AAAAAA", status: ROOM_STATUS.WAITING, revision: 1, you: "p1" };

/** Waits for `check` to hold, and fails the test when it never does, so a wait can never pass by giving up. */
async function until(check, tries = 1000) {
  for (let tried = 0; !check(); tried += 1) {
    if (tried === tries) throw new Error("the condition never held");
    await sleep(25);
  }
}

describe("createSwarm against the real server", () => {
  it("plays whole games of every kind, with and without a computer, rematching and opening new rooms", async () => {
    const server = await realServer();
    const { recorder, swarm } = swarmOn(server.baseUrl);
    const counts = {};
    const failures = {};

    await swarm.grow(24, 50);
    await until(() => {
      const step = recorder.take();
      Object.entries(step.counts).forEach(([name, count]) => (counts[name] = (counts[name] ?? 0) + count));
      Object.assign(failures, step.failures);
      return Object.keys(counts).length === 6 && (counts["games chess people"] ?? 0) > 2;
    });
    const players = swarm.players();
    await swarm.stop();

    expect(failures).toEqual({});
    expect(Object.keys(counts).sort()).toEqual([
      "games chess computer",
      "games chess people",
      "games rps computer",
      "games rps people",
      "games tictactoe computer",
      "games tictactoe people",
    ]);
    expect(players).toBeGreaterThanOrEqual(24);
    expect(swarm.players()).toBe(0);
  }, 30_000);

  it("records each kind of call by name", async () => {
    const server = await realServer();
    const { recorder, swarm } = swarmOn(server.baseUrl);
    const expected = [
      "computer reply chess",
      "computer reply tictactoe",
      "game:move chess",
      "game:move rps",
      "game:move tictactoe",
      "guest sign-in",
      "room:answer",
      "room:create chess",
      "room:create rps",
      "room:create tictactoe",
      "room:join",
      "room:leave",
      "room:play-computer chess",
      "room:play-computer rps",
      "room:play-computer tictactoe",
      "room:request",
      "socket connect",
    ];

    await swarm.grow(24, 0);
    const names = new Set();
    await until(() => {
      Object.keys(recorder.take().times).forEach((name) => names.add(name));
      return expected.every((name) => names.has(name));
    });

    // The computer throws in the same save that starts a Rock Paper Scissors round, so a reply to wait for is rare
    // and may or may not show up.
    expect([...names].filter((name) => name !== "computer reply rps").sort()).toEqual(expected);
  }, 30_000);

  it("counts a refused room and stops that player's games", async () => {
    const server = await realServer({ openRoomsMax: 1 });
    const { recorder, swarm } = swarmOn(server.baseUrl);

    await swarm.grow(8, 0);
    const failures = {};
    await until(() => {
      Object.assign(failures, recorder.take().failures);
      return Object.keys(failures).some((name) => name.endsWith("SERVER_BUSY"));
    });

    expect(Object.keys(failures).every((name) => name.endsWith("SERVER_BUSY"))).toBe(true);
  });
});

describe("createSwarm when the server lets players down", () => {
  async function failuresOf(base, options) {
    const { recorder, swarm } = swarmOn(base, { waitMs: 150, ...options });
    await swarm.grow(1, 0);
    let failures = {};
    await until(() => {
      failures = { ...failures, ...recorder.take().failures };
      return Object.keys(failures).length > 0;
    });
    return failures;
  }
  const computerOnly = { model: { ...QUICK, computerShare: 1 } };
  const peopleOnly = { model: { ...QUICK, computerShare: 0 } };

  it("counts a sign-in the server refused", async () => {
    const base = await fakeServer({ guest: (res) => res.writeHead(503).end() });

    expect(await failuresOf(base, computerOnly)).toEqual({ "player guest sign-in 503": 1 });
  });

  it("counts a socket the server would not let in", async () => {
    const base = await fakeServer({ admit: (socket, next) => next(new Error("go away")) });

    expect(await failuresOf(base, computerOnly)).toEqual({ "player go away": 1 });
  });

  it("counts a call that is never answered", async () => {
    const base = await fakeServer({});

    expect(await failuresOf(base, computerOnly)).toEqual({ "room:play-computer timed out": 1 });
  });

  it("counts a socket the server cut off", async () => {
    const base = await fakeServer({
      handlers: { [SOCKET_EVENTS.ROOM_PLAY_COMPUTER]: ({ socket }) => socket.disconnect(true) },
    });

    expect(await failuresOf(base, computerOnly)).toMatchObject({ "disconnected io server disconnect": 1 });
  });

  it("counts a player left waiting when the game never starts", async () => {
    const answer = ({ ack }) => ack({ ok: true, data: waitingRoom });
    const base = await fakeServer({
      handlers: { [SOCKET_EVENTS.ROOM_CREATE]: answer, [SOCKET_EVENTS.ROOM_JOIN]: answer },
    });

    expect(Object.keys(await failuresOf(base, peopleOnly))).toEqual(["stuck waiting for the server"]);
  });
});

describe("createSwarm when a player's games end", () => {
  it("closes the player's socket and stops counting them as playing", async () => {
    const refuse = ({ ack }) => ack({ ok: false, error: { code: "SERVER_BUSY" } });
    const base = await fakeServer({ handlers: { [SOCKET_EVENTS.ROOM_PLAY_COMPUTER]: refuse } });
    const { recorder, swarm } = swarmOn(base, { model: { ...QUICK, computerShare: 1 } });

    await swarm.grow(1, 0);
    await until(() => Object.keys(recorder.take().failures).length > 0);
    await until(() => swarm.players() === 0);

    expect(swarm.playing()).toBe(0);
  });

  it("counts players as playing while their games go on", async () => {
    const server = await realServer();
    const { swarm } = swarmOn(server.baseUrl);

    await swarm.grow(6, 0);
    await until(() => swarm.players() >= 6);

    expect(swarm.playing()).toBeGreaterThanOrEqual(6);
  });
});

describe("createSwarm when it stops", () => {
  it("stops players who have not arrived yet, so nobody connects after the end", async () => {
    const server = await realServer();
    const { recorder, swarm } = swarmOn(server.baseUrl);

    await swarm.grow(4, 300);
    await swarm.stop();

    expect(swarm.players()).toBe(0);
    expect(recorder.take().failures).toEqual({});
  });

  it("does not count a call cut off by the end of the run as a failure", async () => {
    let asked = false;
    const base = await fakeServer({
      handlers: {
        [SOCKET_EVENTS.ROOM_PLAY_COMPUTER]: () => {
          asked = true;
        },
      },
    });
    const { recorder, swarm } = swarmOn(base, { model: { ...QUICK, computerShare: 1 } });

    await swarm.grow(1, 0);
    await until(() => asked);
    await swarm.stop();

    expect(recorder.take().failures).toEqual({});
  });
});

describe("createSwarm when a game ends while the player thinks", () => {
  it("counts the game and sends no move, as when a chess clock runs out", async () => {
    const board = Array(9).fill("");
    const room = (status, revision, activePlayers) => ({
      code: "BBBBBB",
      status,
      revision,
      you: "p1",
      game: { number: 1, activePlayers, view: { board } },
    });
    const base = await fakeServer({
      handlers: {
        [SOCKET_EVENTS.ROOM_PLAY_COMPUTER]: ({ socket, ack }) => {
          ack({ ok: true, data: room(ROOM_STATUS.PLAYING, 1, ["p1"]) });
          setTimeout(() => socket.emit(SOCKET_EVENTS.ROOM_UPDATED, room(ROOM_STATUS.FINISHED, 2, [])), 20);
        },
      },
    });
    const model = { ...QUICK, computerShare: 1, gameShare: { [GAME_IDS.TIC_TAC_TOE]: 1 } };
    const { recorder, swarm } = swarmOn(base, { model, waitMs: 2_000 });

    await swarm.grow(1, 0);
    let counts = {};
    await until(() => {
      counts = { ...counts, ...recorder.take().counts };
      return Object.keys(counts).length > 0;
    });

    expect(counts).toEqual({ "games tictactoe computer": 1 });
  });
});
