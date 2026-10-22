import mongoose from "mongoose";
import { io as connect } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { MATCH_STEPS, startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { makeServerDatabase } from "./testing/serverDatabase.js";
import { testConfig } from "./testing/testConfig.js";

// BUG-16 (CC-111): a database blip or a crash during the work after a game lost the finished match. Every finished
// game now goes through a stored outbox. Real composition root, real MongoDB (in memory), real sockets.
let mongo;
// Every test runs on the same database, emptied first, so a server start makes no collections or indexes
// after the first one (CC-338, as in server.integration.test.js, CC-336).
const DB = "pipeline";
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

/** Reads a collection through a separate connection, as an outside observer of what was stored. */
async function readCollection(uri, name) {
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    return await connection.db
      .collection(name)
      .find({}, { projection: { _id: 0 } })
      .toArray();
  } finally {
    await connection.close();
  }
}

/** Polls until `probe` answers something other than undefined, failing after 5 s. */
async function eventually(probe, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One server process on the given database. Its log is printed when the test fails. */
async function start({ uri, now, pipeline }) {
  const capture = captureLogger();
  onTestFailed(() => capture.entries.forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`)));
  const server = await startServer({
    config: testConfig({ MONGO_URI: uri }),
    logger: capture.logger,
    ...(now && { now }),
    pipeline,
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await server.close();
  };
  cleanups.push(close);
  return { ...capture, url: `http://127.0.0.1:${server.port}`, close };
}

/** A guest with a session and a connected socket. */
async function guest(server) {
  const res = await fetch(`${server.url}/api/session/guest`, { method: "POST" });
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const socket = connect(server.url, {
    transports: ["websocket"],
    extraHeaders: { cookie },
    reconnection: false,
  });
  cleanups.push(() => socket.disconnect());
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return { socket, cookie };
}

const send = (socket, event, payload) => socket.timeout(3_000).emitWithAck(event, payload);

/** Alice beats Bob at one round of Rock Paper Scissors. Answers Alice's session cookie. */
async function playOneGame(server) {
  const alice = await guest(server);
  const bob = await guest(server);
  const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
    gameId: "rps",
    options: { bestOf: 1 },
  });
  await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
  await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "rock" } });
  const { data: finished } = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, {
    code: room.code,
    move: { choice: "scissors" },
  });
  expect(finished.status).toBe("finished");
  return alice.cookie;
}

async function progressOf(server, cookie) {
  const res = await fetch(`${server.url}/api/progress`, { headers: { cookie } });
  return (await res.json()).progress;
}

/** Wraps one named step of the pipeline. */
const wrapStep = (name, wrap) => (steps) => steps.map((step) => (step.name === name ? wrap(step) : step));

// Two server processes and a game each: slower than one request, most of all on a busy CI runner.
describe("the match pipeline outbox (integration, CC-111)", { timeout: 20_000 }, () => {
  it("awards XP exactly once when the server dies between recording a match and awarding XP", async () => {
    const uri = mongo.uri(DB);
    let resume;
    let reached;
    const stuck = new Promise((resolve) => {
      resume = resolve;
    });
    const inProgression = new Promise((resolve) => {
      reached = resolve;
    });
    // The first process stops in the middle of the progression step, as if it had crashed there.
    const first = await start({
      uri,
      pipeline: {
        steps: wrapStep(MATCH_STEPS.PROGRESSION, (step) => ({
          ...step,
          run: async (input) => {
            reached();
            await stuck;
            return step.run(input);
          },
        })),
      },
    });
    // Cleanups run last first: the stuck step ends before the process is closed.
    cleanups.push(() => resume());
    const alice = await playOneGame(first);
    await inProgression;
    expect(first.find("match recorded")).toHaveLength(1);
    expect(await progressOf(first, alice)).toEqual(expect.objectContaining({ xp: 0, matchesPlayed: 0 }));

    // A new process starts on the same database and finishes what the first one left.
    const second = await start({ uri });
    const awarded = await eventually(async () => {
      const progress = await progressOf(second, alice);
      return progress.matchesPlayed === 1 ? progress : undefined;
    });
    // 30 XP for the win, plus any daily quest the win completed (CC-089).
    expect(awarded).toEqual(expect.objectContaining({ wins: 1, matchesPlayed: 1 }));
    expect(awarded.xp).toBeGreaterThanOrEqual(30);
    const [done] = await eventually(() => {
      const found = second.find("match pipeline done");
      return found.length === 1 ? found : undefined;
    });
    expect(done.steps).toEqual([
      MATCH_STEPS.PROGRESSION,
      MATCH_STEPS.GAMIFICATION,
      MATCH_STEPS.LEADERBOARDS,
      MATCH_STEPS.CHESS_RATINGS,
    ]);
    expect(second.find("match recorded")).toEqual([]);
    const settled = await progressOf(second, alice);

    // Even if the first process comes back to life and finishes its step, nothing is awarded twice.
    resume();
    await first.close();
    expect(await progressOf(second, alice)).toEqual(settled);
    const [entry] = await readCollection(uri, "pending_matches");
    expect(entry).toEqual(expect.objectContaining({ status: "done", attempts: 0 }));
    expect(entry.done).toHaveLength(6);
    expect(await readCollection(uri, "matches")).toHaveLength(1);
  });

  it("retries a step that keeps failing with growing waits, then marks the game failed and logs the alert", async () => {
    const uri = mongo.uri(DB);
    let time = Date.UTC(2026, 9, 18, 12);
    let gamificationRuns = 0;
    const server = await start({
      uri,
      now: () => time,
      pipeline: {
        steps: wrapStep(MATCH_STEPS.GAMIFICATION, (step) => ({
          ...step,
          run: async () => {
            gamificationRuns += 1;
            throw new Error("quests store down");
          },
        })),
        policy: { firstDelayMs: 1_000, maxDelayMs: 4_000, maxAttempts: 3 },
        intervalMs: 10,
      },
    });
    const alice = await playOneGame(server);
    const warnings = () => server.find("match pipeline step failed, will retry");
    const finishedAt = time;
    const [firstFailure] = await eventually(() => (warnings().length === 1 ? warnings() : undefined));

    // Not due yet: the pipeline waits the first delay before trying again.
    time = finishedAt + 999;
    await pause(100);
    expect(gamificationRuns).toBe(1);

    time = finishedAt + 1_000;
    const [, secondFailure] = await eventually(() => (warnings().length === 2 ? warnings() : undefined));
    time = finishedAt + 3_000;
    const [alert] = await eventually(() => {
      const failed = server.find("match pipeline failed");
      return failed.length === 1 ? failed : undefined;
    });
    time = finishedAt + 600_000;
    await pause(100);

    expect([firstFailure, secondFailure]).toEqual([
      expect.objectContaining({
        level: 40,
        step: MATCH_STEPS.GAMIFICATION,
        attempts: 1,
        nextAttemptAt: finishedAt + 1_000,
      }),
      expect.objectContaining({ level: 40, attempts: 2, nextAttemptAt: finishedAt + 3_000 }),
    ]);
    expect(alert).toEqual(
      expect.objectContaining({ level: 50, step: MATCH_STEPS.GAMIFICATION, attempts: 3, alert: true }),
    );
    expect(alert.err.message).toBe("quests store down");
    expect(gamificationRuns).toBe(3);
    // The steps that do not need gamification still did their part.
    expect(server.find("leaderboards applied")).toHaveLength(1);
    expect(await progressOf(server, alice)).toEqual(expect.objectContaining({ xp: 30 }));
    const [entry] = await readCollection(uri, "pending_matches");
    expect(entry).toEqual(
      expect.objectContaining({
        status: "failed",
        attempts: 3,
        lastError: { step: MATCH_STEPS.GAMIFICATION, message: "quests store down" },
      }),
    );
    expect(entry.expiresAt).toBeUndefined();
  });

  it("adds a finished game whose announcement was lost, when the next process starts", async () => {
    const uri = mongo.uri(DB);
    let resume;
    const stuck = new Promise((resolve) => {
      resume = resolve;
    });
    // The first process never gets past adding the game, as if it crashed right after saving the finished room.
    const first = await start({
      uri,
      pipeline: {
        steps: wrapStep(MATCH_STEPS.RECORD, (step) => ({
          ...step,
          run: async (input) => {
            await stuck;
            return step.run(input);
          },
        })),
      },
    });
    cleanups.push(() => resume());
    await playOneGame(first);
    await eventually(async () =>
      (await readCollection(uri, "pending_matches")).length === 1 ? true : undefined,
    );
    // Remove its outbox entry, which is what a crash before adding it would have left.
    const connection = await mongoose.createConnection(uri).asPromise();
    await connection.db.collection("pending_matches").deleteMany({});
    await connection.close();

    const second = await start({ uri });

    await eventually(async () => ((await readCollection(uri, "matches")).length === 1 ? true : undefined));
    expect(second.find("finished games added to the match pipeline late")).toEqual([
      expect.objectContaining({ added: 1 }),
    ]);
    resume();
    await first.close();
    expect(await readCollection(uri, "matches")).toHaveLength(1);
  });
});
