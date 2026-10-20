import { describe, expect, it } from "vitest";
import { BOTS, createBotRegistry, createBotThinker } from "@classicade/games";
import { captureLogger } from "../../testing/captureLogger.js";
import { GoneError } from "../../utils/errors.js";
import { createThinkingQueue } from "./thinkingQueue.js";

const thinker = createBotThinker(createBotRegistry(BOTS));
const chess = (seed, difficulty = "strong") => ({
  gameId: "chess",
  botId: "bot_queenvee_strong",
  difficulty,
  seed,
  view: { moves: ["e4"] },
});
const ticTacToe = Object.freeze({
  gameId: "tictactoe",
  botId: "bot_pip_hard",
  difficulty: "unbeatable",
  seed: 1,
  view: { board: ["X", "", "", "", "", "", "", "", ""], marks: { bot_pip_hard: "O" }, turn: "bot_pip_hard" },
});

/** Workers the test ends one by one: each run waits until the test answers it. */
function heldWorkers(size) {
  const runs = [];
  return {
    runs,
    workers: {
      size,
      run: (request) =>
        new Promise((resolve) => {
          runs.push({ request, answer: resolve, done: false });
        }),
    },
    /** Answers the run for `seed` with a move naming the seed. */
    answer(seed, result = { ok: true, move: { seed } }) {
      const run = runs.find((entry) => entry.request.seed === seed && !entry.done);
      run.done = true;
      run.answer(result);
    },
    running: () => runs.filter((entry) => !entry.done).map((entry) => entry.request.seed),
  };
}

function setup(size = 2) {
  const held = heldWorkers(size);
  const capture = captureLogger();
  const recorded = [];
  let time = 0;
  const queue = createThinkingQueue({
    thinker,
    workers: held.workers,
    logger: capture.logger,
    recordThinking: (entry) => recorded.push(entry),
    clock: () => (time += 5),
  });
  return { ...held, queue, capture, recorded };
}

const settled = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("thinkingQueue", () => {
  it("answers a light level at once on the event loop, without a worker", async () => {
    const { queue, runs, recorded } = setup();

    const move = await queue.think({ room: "ROOM22", request: ticTacToe });

    expect(move).toEqual(thinker.think(ticTacToe));
    expect(runs).toEqual([]);
    expect(recorded).toEqual([{ game: "tictactoe", outcome: "ok", durationMs: 5 }]);
  });

  it("thinks heavy levels of different rooms at once, as many as there are workers", async () => {
    const { queue, running, answer } = setup(3);

    const moves = [1, 2, 3, 4, 5].map((seed) => queue.think({ room: `ROOM${seed}`, request: chess(seed) }));
    await settled();
    expect(running()).toEqual([1, 2, 3]);

    answer(2);
    await settled();
    expect(running()).toEqual([1, 3, 4]);
    [1, 3, 4].forEach((seed) => answer(seed));
    await settled();
    answer(5);

    expect(await Promise.all(moves)).toEqual([1, 2, 3, 4, 5].map((seed) => ({ seed })));
  });

  it("serves rooms in the order they asked, so a busy room never crowds out another", async () => {
    const { queue, running, answer } = setup(1);

    const first = queue.think({ room: "A", request: chess(1) });
    queue.think({ room: "B", request: chess(2) });
    queue.think({ room: "C", request: chess(3) });
    await settled();
    answer(1);
    await first;
    // Room A asks again, after B and C did: it goes behind them.
    queue.think({ room: "A", request: chess(4) });
    await settled();

    const order = [];
    for (let i = 0; i < 3; i++) {
      const [seed] = running();
      order.push(seed);
      answer(seed);
      await settled();
    }
    expect(order).toEqual([2, 3, 4]);
  });

  it("starts a room's next think only after its last one ended, even with free workers", async () => {
    const { queue, running, answer } = setup(4);

    const earlier = queue.think({ room: "A", request: chess(1) });
    const later = queue.think({ room: "A", request: chess(2) });
    await settled();
    expect(running()).toEqual([1]);

    answer(1);
    await settled();
    expect(running()).toEqual([2]);
    answer(2);

    expect(await earlier).toEqual({ seed: 1 });
    expect(await later).toEqual({ seed: 2 });
  });

  it("keeps one waiting think per room: a newer one replaces it, and the older ends as gone", async () => {
    const { queue, running, answer } = setup(1);

    const running1 = queue.think({ room: "A", request: chess(1) });
    const replaced = queue.think({ room: "A", request: chess(2) });
    const newest = queue.think({ room: "A", request: chess(3) });
    await settled();
    answer(1);
    await settled();

    await expect(replaced).rejects.toBeInstanceOf(GoneError);
    expect(running()).toEqual([3]);
    answer(3);
    expect(await running1).toEqual({ seed: 1 });
    expect(await newest).toEqual({ seed: 3 });
  });

  it.each([
    ["timeout", "computer player ran out of time to think"],
    ["crashed", "computer player's thinking crashed"],
  ])("gives the room the easiest level's move after a %s, and says so without ids", async (reason, line) => {
    const { queue, answer, capture, recorded } = setup();

    const move = queue.think({ room: "ROOM22", request: chess(9) });
    await settled();
    answer(9, { ok: false, reason });

    expect(await move).toEqual(thinker.quickest(chess(9)));
    expect(capture.entries).toEqual([expect.objectContaining({ level: 40, msg: line, game: "chess" })]);
    expect(JSON.stringify(capture.entries)).not.toMatch(/ROOM22|bot_queenvee/);
    expect(recorded).toEqual([{ game: "chess", outcome: reason, durationMs: 5 }]);
  });

  it.each([
    [
      "throws",
      () => {
        throw new Error("ERR_WORKER_INIT_FAILED");
      },
    ],
    ["rejects", () => Promise.reject(new Error("lost"))],
  ])(
    "counts a run that %s as a crash, gives the quick move and keeps the room's line going",
    async (_, run) => {
      const capture = captureLogger();
      let calls = 0;
      const queue = createThinkingQueue({
        thinker,
        workers: {
          size: 1,
          run: (request) => {
            calls += 1;
            return calls === 1 ? run() : Promise.resolve({ ok: true, move: { seed: request.seed } });
          },
        },
        logger: capture.logger,
      });

      expect(await queue.think({ room: "A", request: chess(1) })).toEqual(thinker.quickest(chess(1)));
      expect(capture.find("computer player's thinking crashed")).toHaveLength(1);
      // The same room, and another, still think afterwards.
      expect(await queue.think({ room: "A", request: chess(2) })).toEqual({ seed: 2 });
      expect(await queue.think({ room: "B", request: chess(3) })).toEqual({ seed: 3 });
    },
  );

  it("ends the think with the error when settling it fails, and the line goes on", async () => {
    const logger = {
      warn: () => {
        throw new Error("log failed");
      },
    };
    const { workers, answer } = heldWorkers(1);
    const queue = createThinkingQueue({ thinker, workers, logger });

    const failed = queue.think({ room: "A", request: chess(1) });
    const next = queue.think({ room: "B", request: chess(2) });
    await settled();
    answer(1, { ok: false, reason: "timeout" });
    await expect(failed).rejects.toThrow("log failed");
    await settled();
    answer(2);

    expect(await next).toEqual({ seed: 2 });
  });

  it("passes on what the easiest level throws when even the quick move fails", async () => {
    const { queue, answer } = setup();
    const over = { ...chess(9), view: { moves: ["f3", "e5", "g4", "Qh4#"] } };

    const move = queue.think({ room: "ROOM22", request: over });
    await settled();
    answer(9, { ok: false, reason: "timeout" });

    await expect(move).rejects.toThrow(/no move to choose/);
  });

  it("passes on a strategy's error, as before, and counts it as failed", async () => {
    const { queue, answer, recorded } = setup();

    const move = queue.think({ room: "ROOM22", request: chess(9) });
    await settled();
    answer(9, { ok: false, reason: "failed", error: new RangeError("boom") });

    await expect(move).rejects.toThrow("boom");
    expect(recorded).toEqual([{ game: "chess", outcome: "failed", durationMs: 5 }]);
  });

  it("passes on a light level's error, and counts it as failed", async () => {
    const { queue, recorded } = setup();

    await expect(
      queue.think({ room: "ROOM22", request: { ...ticTacToe, difficulty: "no-such-level" } }),
    ).rejects.toThrow(RangeError);
    expect(recorded).toEqual([{ game: "tictactoe", outcome: "failed", durationMs: 5 }]);
  });

  it("ends every waiting think as gone when it stops, and takes no more", async () => {
    const { queue, running, answer } = setup(1);

    const runningThink = queue.think({ room: "A", request: chess(1) });
    const waiting = queue.think({ room: "B", request: chess(2) });
    await settled();
    queue.stop();
    answer(1, { ok: false, reason: "closed" });

    await expect(waiting).rejects.toBeInstanceOf(GoneError);
    await expect(runningThink).rejects.toBeInstanceOf(GoneError);
    await expect(queue.think({ room: "C", request: chess(3) })).rejects.toBeInstanceOf(GoneError);
    expect(running()).toEqual([]);
  });

  it("refuses to start without what it needs", () => {
    const { workers } = heldWorkers(1);
    const logger = captureLogger().logger;

    expect(() => createThinkingQueue({ workers, logger })).toThrow(TypeError);
    expect(() => createThinkingQueue({ thinker, logger })).toThrow(TypeError);
    expect(() => createThinkingQueue({ thinker, workers })).toThrow(TypeError);
    expect(() => createThinkingQueue({ thinker, workers: { ...workers, size: 0 }, logger })).toThrow(
      RangeError,
    );
    expect(() => createThinkingQueue({ thinker, workers, logger })).not.toThrow();
  });
});
