import { afterEach, describe, expect, it } from "vitest";
import { GAME_STATUS } from "@classicade/shared";
import {
  BOTS,
  createBotRegistry,
  createBotThinker,
  createEngineRegistry,
  createSeededRng,
  ENGINES,
} from "@classicade/games";
import { createThinkingQueue } from "../../domain/bots/thinkingQueue.js";
import { captureLogger } from "../../testing/captureLogger.js";
import { createBotThinkingClient } from "./botThinkingClient.js";

const bots = createBotRegistry(BOTS);
const engines = createEngineRegistry(ENGINES);
const thinker = createBotThinker(bots);
const MISBEHAVING = new URL("../../testing/misbehavingThinkingWorker.js", import.meta.url);
const OPTIONS = { chess: { timeControl: "rapid-10+0" }, rps: { bestOf: 5 }, tictactoe: {} };
const SEATS = ["bot_one", "bot_two"];

/**
 * Turns from real games: both seats play the bot's easiest level, and every turn on the way is kept as the request
 * the server would send, its view from the engine and its seed from the game.
 */
function turnsOf(gameId, { games, seed, every = 1 }) {
  const engine = engines.get(gameId);
  const easiest = bots.get(gameId).levels[0].id;
  const turns = [];
  for (let game = 0; game < games; game++) {
    const rng = createSeededRng(seed + game);
    let state = engine.init({ players: SEATS, options: engine.validateOptions(OPTIONS[gameId]).value, rng });
    for (let ply = 0; engine.getOutcome(state).status === GAME_STATUS.ONGOING && ply < 60; ply++) {
      for (const seat of engine.activePlayers(state)) {
        const request = {
          gameId,
          botId: seat,
          difficulty: easiest,
          seed: (seed * 7919 + game * 104729 + ply) >>> 0,
          view: engine.viewFor(state, seat),
        };
        if (ply % every === 0) turns.push(request);
        const move = engine.validateMove(state, seat, thinker.think(request), { now: 0 });
        state = engine.applyMove(state, seat, move.value, { now: 0 });
      }
    }
  }
  return turns;
}

const open = [];
function client(options) {
  const made = createBotThinkingClient({ size: 1, budgetMs: 10_000, ...options });
  open.push(made);
  return made;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((made) => made.close()));
});

/** The longest a 5 ms timer waited while `work` ran, in ms. */
async function longestTimerWait(work) {
  let last = performance.now();
  let longest = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 5);
  try {
    await work();
  } finally {
    clearInterval(timer);
  }
  // A timer that never got to run waited until now.
  return Math.max(longest, performance.now() - last);
}

describe("botThinkingClient", () => {
  it("chooses the same move on a thread as on the event loop, for every game and level (parity)", async () => {
    const pool = client({ size: 2 });
    const requests = [
      ...turnsOf("rps", { games: 3, seed: 11 }),
      ...turnsOf("tictactoe", { games: 4, seed: 21 }),
      ...turnsOf("chess", { games: 2, seed: 31, every: 15 }),
    ].flatMap((request) =>
      bots.get(request.gameId).levels.map((level) => ({ ...request, difficulty: level.id })),
    );
    expect(new Set(requests.map((request) => request.gameId)).size).toBe(3);

    const threaded = [];
    for (let at = 0; at < requests.length; at += 2) {
      threaded.push(...(await Promise.all(requests.slice(at, at + 2).map((request) => pool.run(request)))));
    }

    expect(threaded).toEqual(requests.map((request) => ({ ok: true, move: thinker.think(request) })));
  }, 60_000);

  it("keeps the event loop answering while a deep chess search runs", async () => {
    const pool = client({ size: 1 });
    const queue = createThinkingQueue({ thinker, workers: pool, logger: captureLogger().logger });
    const searches = turnsOf("chess", { games: 1, seed: 41, every: 10 })
      .slice(1, 4)
      .map((request) => ({ ...request, difficulty: "strong" }));
    const started = performance.now();

    const longest = await longestTimerWait(async () => {
      for (const request of searches) await queue.think({ room: "ROOM22", request });
    });

    // Each Strong search holds the CPU for 0.1 to 0.5 s. On the event loop a timer would wait that long.
    expect(performance.now() - started).toBeGreaterThan(150);
    expect(longest).toBeLessThan(60);
  }, 30_000);

  it("thinks for several rooms at once, one per thread", async () => {
    const pool = client({ size: 3, workerUrl: MISBEHAVING });

    const answers = await Promise.all([1, 2, 3].map((seed) => pool.run({ gameId: "race", seed })));

    expect(new Set(answers.map((answer) => answer.move.thread)).size).toBe(3);
    expect(() => {
      pool.run({ gameId: "hang", seed: 4 });
      pool.run({ gameId: "hang", seed: 5 });
      pool.run({ gameId: "hang", seed: 6 });
      pool.run({ gameId: "race", seed: 7 });
    }).toThrow(/Every thinking thread is busy/);
  });

  it("ends a think that runs past its budget, and a new thread answers the next one", async () => {
    const pool = client({ budgetMs: 200, workerUrl: MISBEHAVING });
    const { move: before } = await pool.run({ gameId: "race", seed: 1 });

    expect(await pool.run({ gameId: "hang", seed: 2 })).toEqual({ ok: false, reason: "timeout" });
    const { move: after } = await pool.run({ gameId: "race", seed: 3 });

    expect(after.seed).toBe(3);
    expect(after.thread).not.toBe(before.thread);
  });

  it("ends a real Strong search that has too little time", async () => {
    const pool = client({ budgetMs: 5 });
    const [, request] = turnsOf("chess", { games: 1, seed: 51, every: 10 });

    expect(await pool.run({ ...request, difficulty: "strong" })).toEqual({ ok: false, reason: "timeout" });
  });

  it.each(["throw", "exit", "hog"])(
    "counts a thread that fails (%s) as crashed, and starts a new one",
    async (gameId) => {
      const pool = client({ workerUrl: MISBEHAVING });

      expect(await pool.run({ gameId, seed: 1 })).toEqual({ ok: false, reason: "crashed" });
      expect((await pool.run({ gameId: "race", seed: 2 })).move.seed).toBe(2);
    },
    20_000,
  );

  it("passes on the strategy's error by name and message", async () => {
    const pool = client({});
    const [request] = turnsOf("tictactoe", { games: 1, seed: 1 });

    const result = await pool.run({ ...request, difficulty: "no-such-level" });

    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(result.error).toMatchObject({ name: "RangeError", message: expect.stringMatching(/Unknown/) });
  });

  it("answers failed for a request that cannot be sent to a thread", async () => {
    const pool = client({});

    const result = await pool.run({ gameId: "chess", seed: 1, view: { moves: () => [] } });

    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect((await pool.run(turnsOf("tictactoe", { games: 1, seed: 1 })[0])).ok).toBe(true);
  });

  it("answers closed and ends every thread at shutdown, within its time, even mid-search", async () => {
    const pool = createBotThinkingClient({ size: 2, budgetMs: 60_000, workerUrl: MISBEHAVING });
    const stuck = [pool.run({ gameId: "hang", seed: 1 }), pool.run({ gameId: "hang", seed: 2 })];
    const started = performance.now();

    await pool.close();
    await pool.close();

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(await Promise.all(stuck)).toEqual([
      { ok: false, reason: "closed" },
      { ok: false, reason: "closed" },
    ]);
    expect(await pool.run({ gameId: "race", seed: 3 })).toEqual({ ok: false, reason: "closed" });
  });

  it("stops waiting for threads after closeWithinMs", async () => {
    const pool = createBotThinkingClient({ size: 1, budgetMs: 1_000, closeWithinMs: 1 });

    await expect(pool.close()).resolves.toBeUndefined();
  });

  it.each([
    [{ size: 0, budgetMs: 1 }, /size/],
    [{ size: 1.5, budgetMs: 1 }, /size/],
    [{ size: 1, budgetMs: 0 }, /budgetMs/],
  ])("refuses options it cannot use (%#)", (options, message) => {
    expect(() => createBotThinkingClient(options)).toThrow(message);
  });
});
