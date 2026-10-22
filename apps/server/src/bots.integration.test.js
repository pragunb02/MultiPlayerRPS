import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { io as connect } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import { BOT_DAILY_XP, CHESS_ACTIONS, SOCKET_EVENTS } from "@classicade/shared";
import { createBotThinkingClient } from "./dependency/thinking/botThinkingClient.js";
import { startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { makeServerDatabase } from "./testing/serverDatabase.js";
import { testConfig } from "./testing/testConfig.js";

// Games against computer characters through the real server on MongoDB (CC-138, CC-221, CC-225): the real
// composition root, the real bot driver, the real match pipeline. Computer players act without a pause here.
let mongo;
// Every test runs on the same database, emptied first, so a server start makes no collections or indexes
// after the first one (CC-338, as in server.integration.test.js, CC-336).
const DB = "bots";
const cleanups = [];
const NO_PAUSE = Object.freeze({ pauseMs: { min: 0, max: 0 } });
const NOON = Date.UTC(2026, 9, 20, 12);

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

/**
 * One server process on one database. `restart` stops it the way a deploy does and starts the next one, and `stop`
 * stops it for good. `rooms` and `now` go to the server as they are (see startServer).
 */
function serverProcess({ bots = NO_PAUSE, rooms, now } = {}) {
  let config = testConfig({ MONGO_URI: mongo.uri(DB) });
  let running;
  let capture;
  const logs = [];
  onTestFailed(() => logs.flat().forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`)));
  async function start(options = bots) {
    capture = captureLogger();
    running = await startServer({ config, logger: capture.logger, bots: options, rooms, now });
    logs.push(capture.entries);
    config = testConfig({ MONGO_URI: config.mongoUri, PORT: String(running.port) });
    return running;
  }
  cleanups.push(() => running?.close());
  return {
    start,
    config: () => config,
    url: () => `http://127.0.0.1:${running.port}`,
    logs: () => logs.flat(),
    /** The first line of the running process with this message, when it is written. */
    once: (msg) => capture.once(msg),
    async stop() {
      const stopped = running;
      running = undefined;
      await stopped.close();
    },
    async restart(options) {
      const stopped = running;
      running = undefined;
      await stopped.close();
      return start(options);
    },
  };
}

/** A guest with a socket that reconnects by itself and rejoins `room.code` after every connect, like a browser. */
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
  // The newest view of the player's room, from answers and updates alike. A computer player's update can overtake
  // the answer to the request it replies to, so the revision decides which is newer, as the web app does.
  const keep = (view) => {
    if (view?.code === undefined) return;
    if (player.latest?.code !== view.code || view.revision > player.latest.revision) player.latest = view;
    settle(player.waiting.rooms, player.latest);
  };
  const player = {
    identity,
    cookie,
    socket,
    room: { code: "" },
    progress: [],
    latest: undefined,
    waiting: { rooms: [], progress: [] },
    async send(event, payload) {
      const answer = await socket.timeout(4_000).emitWithAck(event, payload);
      keep(answer.data);
      return answer;
    },
  };
  socket.on(SOCKET_EVENTS.ROOM_UPDATED, keep);
  socket.on(SOCKET_EVENTS.PROGRESS_UPDATED, (update) => {
    player.progress.push(update);
    settle(player.waiting.progress, player.progress);
  });
  socket.io.on("reconnect", () => {
    if (player.room.code !== "") socket.emit(SOCKET_EVENTS.ROOM_JOIN, { code: player.room.code }, () => {});
  });
  return player;
}

/** Answers every waiter whose test `value` passes, and keeps the others waiting. */
function settle(waiters, value) {
  for (const waiter of waiters.filter(({ test }) => test(value))) {
    waiters.splice(waiters.indexOf(waiter), 1);
    waiter.resolve(value);
  }
}

/** Resolves with `value()` once it passes `test`: at once, or when the update that makes it pass arrives. */
function when(waiters, value, test) {
  return test(value()) ? Promise.resolve(value()) : new Promise((resolve) => waiters.push({ test, resolve }));
}

/** Waits for the update after which the newest view of the player's room passes `test`, and answers that view. */
const updateWhere = (player, test) =>
  when(
    player.waiting.rooms,
    () => player.latest,
    (view) => view !== undefined && test(view),
  );

/** Waits for the progress update after which the player's updates pass `test`, and answers them all. */
const progressWhere = (player, test) => when(player.waiting.progress, () => player.progress, test);

/** Polls `probe` until it returns a value. */
async function eventually(probe, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function readCollection(uri, name) {
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    return await connection.db.collection(name).find().toArray();
  } finally {
    await connection.close();
  }
}

/** Starts a game against the computer and catches up with anything the computer did before the socket joined. */
async function playComputer(player, payload) {
  const started = await player.send(SOCKET_EVENTS.ROOM_PLAY_COMPUTER, payload);
  expect(started.ok).toBe(true);
  player.room.code = started.data.code;
  return (await player.send(SOCKET_EVENTS.ROOM_JOIN, { code: started.data.code })).data;
}

// Views name players by seat id (CC-253): the viewer's own is `you`.
const yourTurn = (view) => view.status !== "playing" || view.game.activePlayers.includes(view.you);
/** The seat id of the computer player in a view. */
const computerIn = (view) => view.seats.find((seat) => seat.bot !== undefined).playerId;

/** Plays Rock Paper Scissors with `choose` until the match is over. Answers the final view. */
async function playRps(player, view, choose = () => "rock") {
  let current = view;
  for (let round = 0; current.status === "playing"; round++) {
    const over = (v) => v.status !== "playing" || v.game.view.rounds.length > round;
    const answer = await player.send(SOCKET_EVENTS.GAME_MOVE, {
      code: current.code,
      move: { choice: choose(round) },
    });
    // A refused throw fails here, with its reason, instead of leaving the test to wait for a round that never ends.
    expect(answer).toMatchObject({ ok: true });
    current = await updateWhere(player, over);
  }
  return current;
}

/** Plays Tic-Tac-Toe in the first free cell each turn until the game is over. */
async function playTicTacToe(player, view) {
  let current = view;
  while (current.status === "playing") {
    current = await updateWhere(player, yourTurn);
    if (current.status !== "playing") break;
    const cell = current.game.view.board.indexOf("");
    current = (await player.send(SOCKET_EVENTS.GAME_MOVE, { code: current.code, move: { cell } })).data;
  }
  return current;
}

describe("playing computer characters on the real server (integration)", () => {
  it("plays Rock Paper Scissors against Rocky to a recorded result, every lock checkable", async () => {
    const server = serverProcess();
    await server.start();
    const alice = await guest(server);
    const start = await playComputer(alice, { gameId: "rps", level: "hard", options: { bestOf: 3 } });
    const lockBeforeFirstThrow = start.fairness.locked[0].commitment;

    const final = await playRps(alice, start);

    expect(final.status).toBe("finished");
    expect(final.fairness.checks[0].commitment).toBe(lockBeforeFirstThrow);
    for (const check of final.fairness.checks) {
      expect(createHash("sha256").update(`${check.text}:${check.salt}`).digest("hex")).toBe(check.commitment);
    }
    const [match] = await eventually(async () => {
      const docs = await readCollection(server.config().mongoUri, "matches");
      return docs[0]?.credit === undefined ? undefined : docs;
    });
    expect(match.players.map((p) => p.playerId)).toEqual([alice.identity.id, "bot_rocky_hard"]);
    expect(match.credit.botXp).toEqual([expect.objectContaining({ playerId: alice.identity.id })]);
  });

  it("plays Tic-Tac-Toe against Unbeatable Pip, who never loses, and the reward says what is left today", async () => {
    const server = serverProcess();
    await server.start();
    const alice = await guest(server);

    const final = await playTicTacToe(
      alice,
      await playComputer(alice, { gameId: "tictactoe", level: "hard" }),
    );

    expect(final.status).toBe("finished");
    expect(final.game.outcome.winners).not.toContain(final.you);
    const [update] = await progressWhere(alice, (updates) => updates.length > 0);
    expect(update).toEqual(
      expect.objectContaining({ counted: true, botXpLeft: BOT_DAILY_XP - update.xpGained }),
    );
    const progress = await readCollection(server.config().mongoUri, "player_progress");
    expect(progress.map((doc) => doc.playerId)).toEqual([alice.identity.id]);
  });

  it("plays chess against Queen Vee the beginner until the person resigns, and declines a draw at once", async () => {
    const server = serverProcess();
    await server.start();
    const alice = await guest(server);
    await playComputer(alice, { gameId: "chess", level: "easy" });
    const first = await updateWhere(alice, yourTurn);
    const white = first.game.view.colors[first.you] === "w";
    const moves = white
      ? [
          ["e2", "e4"],
          ["d2", "d4"],
        ]
      : [
          ["e7", "e6"],
          ["d7", "d6"],
        ];

    // A move the beginner's reply made impossible is simply refused, and the next one is tried.
    for (const [from, to] of moves) {
      const { code } = await updateWhere(alice, yourTurn);
      await alice.send(SOCKET_EVENTS.GAME_MOVE, { code, move: { type: CHESS_ACTIONS.MOVE, from, to } });
    }
    const view = await updateWhere(alice, yourTurn);
    await alice.send(SOCKET_EVENTS.ROOM_REQUEST, { code: view.code, type: "draw" });
    await updateWhere(alice, (v) => v.requests.some((r) => r.type === "draw" && r.state === "declined"));
    const resigned = await alice.send(SOCKET_EVENTS.GAME_MOVE, {
      code: view.code,
      move: { type: CHESS_ACTIONS.RESIGN },
    });

    expect(resigned.data.status).toBe("finished");
    expect(resigned.data.game.outcome.winners).toEqual([computerIn(resigned.data)]);
  });

  it("gives at most the day's XP from computer games, apart from quest XP, and every game still counts", async () => {
    // Noon UTC on a fixed day, so the five games always fall in one day of the limit (ADR-025). The clock still runs.
    const started = Date.now();
    const server = serverProcess({
      now: () => NOON + (Date.now() - started),
      // A script throws far faster than a person: the event budget would refuse it after about twenty (CC-107).
      rooms: { limits: { eventBurstPerPlayer: 1_000 } },
    });
    await server.start();
    const alice = await guest(server);
    // Quests completed by these games give their own XP, which is not part of the limit (ADR-025).
    const fromGames = (updates) => updates.filter((update) => update.source === "match");

    for (let game = 0; game < 5; game++) {
      const view = await playComputer(alice, { gameId: "rps", level: "easy", options: { bestOf: 1 } });
      await playRps(alice, view, () => "paper");
      await progressWhere(alice, (updates) => fromGames(updates).length > game);
    }

    const counted = fromGames(alice.progress);
    const gained = counted.reduce((sum, update) => sum + update.xpGained, 0);
    // Five games give at least 50 XP without a limit, so a total above it would show the limit is missing.
    expect(gained).toBeLessThanOrEqual(BOT_DAILY_XP);
    expect(counted.at(-1).botXpLeft).toBe(BOT_DAILY_XP - gained);
    expect(counted.every((update) => update.counted)).toBe(true);
    const progress = await readCollection(server.config().mongoUri, "player_progress");
    expect(progress[0].matchesPlayed).toBe(5);
    // The computer played each moment once, and the tab that closed was recorded before the database closed.
    alice.socket.disconnect();
    await server.once("socket disconnected");
    await server.stop();
    expect(server.logs().filter((entry) => entry.level >= 40)).toEqual([]);
  });

  it("moves on after a restart in the middle of a game: the computer whose turn it was plays", async () => {
    // A long pause, so the computer has not moved when the server stops.
    const server = serverProcess({ bots: { pauseMs: { min: 60_000, max: 60_000 } } });
    await server.start();
    const alice = await guest(server);
    let view = await playComputer(alice, { gameId: "tictactoe", level: "easy" });
    if (view.game.activePlayers.includes(view.you)) {
      view = (
        await alice.send(SOCKET_EVENTS.GAME_MOVE, {
          code: view.code,
          move: { cell: view.game.view.board.indexOf("") },
        })
      ).data;
    }
    expect(view.game.activePlayers).toEqual([computerIn(view)]);
    const marks = view.game.view.board.filter((cell) => cell !== "").length;

    await server.restart(NO_PAUSE);

    // Pip may move before this browser is back in the room, so it asks for the room until his mark is there.
    const after = await eventually(async () => {
      const answer = await alice.send(SOCKET_EVENTS.ROOM_JOIN, { code: view.code }).catch(() => undefined);
      const board = answer?.data?.game.view.board ?? [];
      return board.filter((cell) => cell !== "").length > marks ? answer.data : undefined;
    }, 20_000);
    expect(after.game.activePlayers).toEqual(after.status === "playing" ? [after.you] : []);
    expect(after.seats.find((seat) => seat.playerId === computerIn(after)).connected).toBe(true);
  });

  it("still moves when Strong runs out of time to think, and says so without ids (CC-308)", async () => {
    // A budget no Strong search fits in: every think ends in a timeout, and the room gets Beginner's move.
    const server = serverProcess({
      bots: {
        ...NO_PAUSE,
        thinkingWorkers: (settings) => createBotThinkingClient({ ...settings, budgetMs: 1 }),
      },
    });
    await server.start();
    const alice = await guest(server);
    await playComputer(alice, { gameId: "chess", level: "hard" });
    const first = await updateWhere(alice, yourTurn);
    const white = first.game.view.colors[first.you] === "w";
    const { code } = first;
    await alice.send(SOCKET_EVENTS.GAME_MOVE, {
      code,
      move: { type: CHESS_ACTIONS.MOVE, from: white ? "e2" : "e7", to: white ? "e4" : "e5" },
    });

    const replied = await updateWhere(alice, (view) => yourTurn(view) && view.game.view.moves.length >= 2);

    expect(replied.status).toBe("playing");
    const lines = server.logs().filter((entry) => entry.msg === "computer player ran out of time to think");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatchObject({ level: 40, game: "chess" });
    expect(JSON.stringify(lines)).not.toContain(code);
    expect(JSON.stringify(lines)).not.toMatch(/bot_queenvee|guest_/);
  });

  it("ends its thinking threads well inside the shutdown budget, even mid-think (CC-305, CC-308)", async () => {
    let workers;
    const running = await startServer({
      config: testConfig({ MONGO_URI: mongo.uri(DB) }),
      logger: captureLogger().logger,
      bots: {
        ...NO_PAUSE,
        thinkingWorkers: (settings) => {
          workers = createBotThinkingClient({
            ...settings,
            workerUrl: new URL("./testing/misbehavingThinkingWorker.js", import.meta.url),
          });
          return workers;
        },
      },
    });
    const stuck = workers.run({ gameId: "hang", seed: 1 });
    const started = performance.now();

    await running.close();

    expect(performance.now() - started).toBeLessThan(5_000);
    expect(await stuck).toEqual({ ok: false, reason: "closed" });
  });
});
