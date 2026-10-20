import { BOT_THINKING_OUTCOMES, NO_OPERATIONS_METRICS } from "../../utils/operationsMetrics.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { GoneError } from "../../utils/errors.js";

/**
 * @typedef {import("@classicade/games").ThinkRequest} ThinkRequest
 *
 * @typedef {{ ok: true, move: unknown }
 *   | { ok: false, reason: "timeout" | "crashed" | "closed" }
 *   | { ok: false, reason: "failed", error: Error }} ThinkResult   how a think on a worker ended. `failed` is the
 *   strategy throwing, `closed` the workers shutting down
 *
 * @typedef {Object} ThinkingWorkers   the threads heavy thinking runs on (`dependency/thinking/`)
 * @property {number} size                                         how many can think at once
 * @property {(request: Readonly<ThinkRequest>) => Promise<ThinkResult>} run   never rejects, and never runs more
 *   than `size` at once
 */

/** The named lines (ADR-055) for a think that did not end in a move, by how it ended. */
const FALLBACK_LINES = Object.freeze({
  timeout: "computer player ran out of time to think",
  crashed: "computer player's thinking crashed",
});

const gone = () => new GoneError("The computer player's turn passed before it was thought about");

/**
 * The line computer players think in (CC-138, CC-308, ADR-067). Light levels (Rock Paper Scissors, Tic-Tac-Toe)
 * answer at once on the event loop. Heavy ones (chess) think on worker threads, so the event loop keeps answering
 * people meanwhile, and as many think at once as there are workers.
 *
 * The line is fair per room. Each room has at most one think waiting and one running, and rooms are served in the
 * order they asked, so no room can crowd out another. A room's next think starts only after its last one ended, so
 * one room's moves are never chosen out of order. A newer think for a room replaces its waiting one, whose moment
 * has passed, and the older one ends with a GoneError.
 *
 * A think that runs out of time or whose thread fails still gives the room a move: the bot's easiest level chooses
 * one on the event loop from the same view and seed. A strategy that throws is passed on as before.
 *
 * @param {{
 *   thinker: ReturnType<typeof import("@classicade/games").createBotThinker>,
 *   workers: Readonly<ThinkingWorkers>,
 *   logger: Pick<import("../../utils/logger.js").Logger, "warn">,
 *   recordThinking?: import("../../utils/operationsMetrics.js").OperationsMetrics["recordBotThinking"],
 *   clock?: () => number,
 * }} deps  `clock` reads milliseconds, for the metric
 */
export function createThinkingQueue({
  thinker,
  workers,
  logger,
  recordThinking = NO_OPERATIONS_METRICS.recordBotThinking,
  clock = () => performance.now(),
}) {
  assertDefined(thinker, "thinker");
  assertFunction(workers?.run, "workers.run");
  assertDefined(logger, "logger");
  if (!(Number.isInteger(workers.size) && workers.size >= 1)) {
    throw new RangeError("workers.size must be a whole number of at least 1");
  }

  /** Per room code: the think waiting for a worker, and whether one is running. */
  const rooms = new Map();
  /** Room codes with a think waiting and none running, in the order they asked. */
  const line = [];
  let running = 0;
  let stopped = false;

  const record = (request, outcome, started) =>
    recordThinking({ game: request.gameId, outcome, durationMs: clock() - started });

  function settle(entry, result) {
    if (result.ok) {
      record(entry.request, BOT_THINKING_OUTCOMES.OK, entry.started);
      entry.resolve(result.move);
    } else if (result.reason === "failed") {
      record(entry.request, BOT_THINKING_OUTCOMES.FAILED, entry.started);
      entry.reject(result.error);
    } else if (result.reason === "closed") {
      entry.reject(gone());
    } else {
      record(entry.request, result.reason, entry.started);
      logger.warn({ game: entry.request.gameId }, FALLBACK_LINES[result.reason]);
      quickly(entry);
    }
  }

  /** The easiest level's move for the same turn, or the error it threw. */
  function quickly(entry) {
    try {
      entry.resolve(thinker.quickest(entry.request));
    } catch (err) {
      entry.reject(err);
    }
  }

  function next() {
    while (!stopped && running < workers.size && line.length > 0) {
      const code = line.shift();
      const room = rooms.get(code);
      const entry = room.waiting;
      room.waiting = undefined;
      room.running = true;
      running += 1;
      workers.run(entry.request).then((result) => {
        running -= 1;
        room.running = false;
        if (room.waiting === undefined) rooms.delete(code);
        else line.push(code);
        settle(entry, result);
        next();
      });
    }
  }

  return Object.freeze({
    /**
     * The move for a computer player's turn in a room.
     *
     * @param {{ room: string, request: Readonly<ThinkRequest> }} input  `room` is the room's code
     * @returns {Promise<unknown>} the raw move
     * @throws {GoneError} when a newer turn of the room replaced this one, or the queue stopped
     */
    async think({ room: code, request }) {
      if (stopped) throw gone();
      if (!thinker.isHeavy(request)) {
        const started = clock();
        try {
          const move = thinker.think(request);
          record(request, BOT_THINKING_OUTCOMES.OK, started);
          return move;
        } catch (err) {
          record(request, BOT_THINKING_OUTCOMES.FAILED, started);
          throw err;
        }
      }
      return new Promise((resolve, reject) => {
        const entry = { request, resolve, reject, started: clock() };
        const room = rooms.get(code) ?? { waiting: undefined, running: false };
        rooms.set(code, room);
        if (room.waiting !== undefined) {
          room.waiting.reject(gone());
        } else if (!room.running) {
          line.push(code);
        }
        room.waiting = entry;
        next();
      });
    },

    /** Ends every waiting think with a GoneError and takes no more. Called when the server shuts down. */
    stop() {
      stopped = true;
      for (const room of rooms.values()) {
        room.waiting?.reject(gone());
        room.waiting = undefined;
      }
      line.length = 0;
    },
  });
}
