import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { io as connect } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import { BOT_DAILY_XP, CHESS_ACTIONS, SOCKET_EVENTS } from "@classicade/shared";
import { startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { testConfig } from "./testing/testConfig.js";

// Games against computer characters through the real server on MongoDB (CC-138, CC-221, CC-225): the real
// composition root, the real bot driver, the real match pipeline. Computer players act without a pause here.
let mongo;
let dbCounter = 0;
const cleanups = [];
const NO_PAUSE = Object.freeze({ pauseMs: { min: 0, max: 0 } });

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

/** One server process on one database. `restart` stops it the way a deploy does and starts the next one. */
function serverProcess({ bots = NO_PAUSE } = {}) {
  let config = testConfig({ MONGO_URI: mongo.uri(`bots-${++dbCounter}`) });
  let running;
  const logs = [];
  onTestFailed(() => logs.flat().forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`)));
  async function start(options = bots) {
    const capture = captureLogger();
    running = await startServer({ config, logger: capture.logger, bots: options });
    logs.push(capture.entries);
    config = testConfig({ MONGO_URI: config.mongoUri, PORT: String(running.port) });
    return running;
  }
  cleanups.push(() => running?.close());
  return {
    start,
    config: () => config,
    url: () => `http://127.0.0.1:${running.port}`,
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
  };
  const player = {
    identity,
    cookie,
    socket,
    room: { code: "" },
    progress: [],
    latest: undefined,
    async send(event, payload) {
      const answer = await socket.timeout(4_000).emitWithAck(event, payload);
      keep(answer.data);
      return answer;
    },
  };
  socket.on(SOCKET_EVENTS.ROOM_UPDATED, keep);
  socket.on(SOCKET_EVENTS.PROGRESS_UPDATED, (update) => player.progress.push(update));
  socket.io.on("reconnect", () => {
    if (player.room.code !== "") socket.emit(SOCKET_EVENTS.ROOM_JOIN, { code: player.room.code }, () => {});
  });
  return player;
}

/** Waits until the newest view of the player's room passes `test`, and answers it. */
async function updateWhere(player, test) {
  const deadline = Date.now() + 10_000;
  while (player.latest === undefined || !test(player.latest)) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the room");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return player.latest;
}

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

const yourTurn = (player) => (view) =>
  view.status !== "playing" || view.game.activePlayers.includes(player.identity.id);

/** Plays Rock Paper Scissors with `choose` until the match is over. Answers the final view. */
async function playRps(player, view, choose = () => "rock") {
  let current = view;
  for (let round = 0; current.status === "playing"; round++) {
    const over = (v) => v.status !== "playing" || v.game.view.rounds.length > round;
    await player.send(SOCKET_EVENTS.GAME_MOVE, { code: current.code, move: { choice: choose(round) } });
    current = await updateWhere(player, over);
  }
  return current;
}

/** Plays Tic-Tac-Toe in the first free cell each turn until the game is over. */
async function playTicTacToe(player, view) {
  let current = view;
  while (current.status === "playing") {
    current = await updateWhere(player, yourTurn(player));
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
    expect(final.game.outcome.winners).not.toContain(alice.identity.id);
    const [update] = await eventually(async () => (alice.progress.length > 0 ? alice.progress : undefined));
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
    const white = (await updateWhere(alice, yourTurn(alice))).game.view.colors[alice.identity.id] === "w";
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
      const { code } = await updateWhere(alice, yourTurn(alice));
      await alice.send(SOCKET_EVENTS.GAME_MOVE, { code, move: { type: CHESS_ACTIONS.MOVE, from, to } });
    }
    const view = await updateWhere(alice, yourTurn(alice));
    await alice.send(SOCKET_EVENTS.ROOM_REQUEST, { code: view.code, type: "draw" });
    await updateWhere(alice, (v) => v.requests.some((r) => r.type === "draw" && r.state === "declined"));
    const resigned = await alice.send(SOCKET_EVENTS.GAME_MOVE, {
      code: view.code,
      move: { type: CHESS_ACTIONS.RESIGN },
    });

    expect(resigned.data.status).toBe("finished");
    expect(resigned.data.game.outcome.winners).toEqual(["bot_queen-vee_easy"]);
  });

  it("gives at most the day's XP from computer games, apart from quest XP, and every game still counts", async () => {
    const server = serverProcess();
    await server.start();
    const alice = await guest(server);
    // Quests completed by these games give their own XP, which is not part of the limit (ADR-025).
    const fromGames = () => alice.progress.filter((update) => update.source === "match");

    for (let game = 0; game < 5; game++) {
      const view = await playComputer(alice, { gameId: "rps", level: "easy", options: { bestOf: 1 } });
      await playRps(alice, view, () => "paper");
      await eventually(async () => (fromGames().length > game ? true : undefined));
    }

    const gained = fromGames().reduce((sum, update) => sum + update.xpGained, 0);
    // Five games give at least 50 XP without a limit, so a total above it would show the limit is missing.
    expect(gained).toBeLessThanOrEqual(BOT_DAILY_XP);
    expect(fromGames().at(-1).botXpLeft).toBe(BOT_DAILY_XP - gained);
    expect(fromGames().every((update) => update.counted)).toBe(true);
    const progress = await readCollection(server.config().mongoUri, "player_progress");
    expect(progress[0].matchesPlayed).toBe(5);
  });

  it("moves on after a restart in the middle of a game: the computer whose turn it was plays", async () => {
    // A long pause, so the computer has not moved when the server stops.
    const server = serverProcess({ bots: { pauseMs: { min: 60_000, max: 60_000 } } });
    await server.start();
    const alice = await guest(server);
    let view = await playComputer(alice, { gameId: "tictactoe", level: "easy" });
    if (view.game.activePlayers.includes(alice.identity.id)) {
      view = (
        await alice.send(SOCKET_EVENTS.GAME_MOVE, {
          code: view.code,
          move: { cell: view.game.view.board.indexOf("") },
        })
      ).data;
    }
    expect(view.game.activePlayers).toEqual([`bot_pip_easy`]);
    const marks = view.game.view.board.filter((cell) => cell !== "").length;

    await server.restart(NO_PAUSE);

    // Pip may move before this browser is back in the room, so it asks for the room until his mark is there.
    const after = await eventually(async () => {
      const answer = await alice.send(SOCKET_EVENTS.ROOM_JOIN, { code: view.code }).catch(() => undefined);
      const board = answer?.data?.game.view.board ?? [];
      return board.filter((cell) => cell !== "").length > marks ? answer.data : undefined;
    }, 20_000);
    expect(after.game.activePlayers).toEqual(after.status === "playing" ? [alice.identity.id] : []);
    expect(after.seats.find((seat) => seat.playerId === "bot_pip_easy").connected).toBe(true);
  });
});
