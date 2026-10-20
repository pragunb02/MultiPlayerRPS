import { Worker } from "node:worker_threads";

/** The worker each thread runs: the bots of `@classicade/games`, nothing else. */
export const BOT_THINKING_WORKER = new URL("./botThinkingWorker.js", import.meta.url);

/** How long shutting down waits for the threads to end. Well inside the shutdown's 10 s drain (CC-305). */
export const CLOSE_WITHIN_MS = 2_000;

/**
 * The most JavaScript heap one thread may use. A search needs a few MB; a runaway one ends its own thread, which
 * counts as a crash, instead of filling the 512 MB of the whole server.
 */
const RESOURCE_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 64 });

/**
 * A small pool of worker threads that choose computer moves off the event loop (ADR-067). It runs at most `size`
 * thinks at once, one per thread, and the caller (the thinking queue) decides which goes next. It never rejects:
 * every think ends in a move, the strategy's error, a timeout, a crash, or `closed` at shutdown.
 *
 * A think that runs past `budgetMs`, and a thread that throws, exits or runs out of memory, ends that thread. A new
 * one starts for the next think, so a stuck search never holds a thread for good.
 *
 * @param {{
 *   size: number,
 *   budgetMs: number,
 *   workerUrl?: URL,
 *   closeWithinMs?: number,
 * }} options  `workerUrl` is for tests, which give a worker that hangs or crashes on purpose
 */
export function createBotThinkingClient({
  size,
  budgetMs,
  workerUrl = BOT_THINKING_WORKER,
  closeWithinMs = CLOSE_WITHIN_MS,
}) {
  if (!(Number.isInteger(size) && size >= 1))
    throw new RangeError("size must be a whole number of at least 1");
  if (!(Number.isInteger(budgetMs) && budgetMs >= 1))
    throw new RangeError("budgetMs must be a whole number of ms");

  /** One per thread: its worker while one is running, and the think it is on. */
  const slots = Array.from({ length: size }, () => ({ worker: undefined, job: undefined }));
  let nextId = 0;
  let closed = false;

  function finish(slot, result) {
    const { job } = slot;
    if (job === undefined) return;
    clearTimeout(job.timer);
    slot.job = undefined;
    job.resolve(result);
  }

  /** Ends the slot's thread and the think it was on. The next think starts a new thread. */
  function fail(slot, reason) {
    const { worker } = slot;
    slot.worker = undefined;
    // terminate() answers the exit code and never rejects.
    worker?.terminate();
    finish(slot, { ok: false, reason });
  }

  function spawn(slot) {
    const worker = new Worker(workerUrl, { resourceLimits: { ...RESOURCE_LIMITS } });
    // Only a running think keeps the process going, through its own timer: an idle thread never does.
    worker.unref();
    const current = () => slot.worker === worker;
    worker.on("message", (reply) => {
      if (!current() || slot.job?.id !== reply.id) return;
      if (reply.ok) {
        finish(slot, { ok: true, move: reply.move });
      } else {
        const error = new Error(reply.message);
        error.name = reply.name;
        finish(slot, { ok: false, reason: "failed", error });
      }
    });
    worker.on("error", () => current() && fail(slot, "crashed"));
    worker.on("exit", () => current() && fail(slot, "crashed"));
    slot.worker = worker;
  }

  // Threads start with the server, so the first computer move does not wait for one to load.
  slots.forEach(spawn);

  return Object.freeze({
    size,

    /**
     * Thinks about one turn on a free thread.
     *
     * @param {Readonly<import("@classicade/games").ThinkRequest>} request
     * @returns {Promise<{ ok: true, move: unknown } | { ok: false, reason: "timeout" | "crashed" | "closed" }
     *   | { ok: false, reason: "failed", error: Error }>}
     * @throws {RangeError} at once when all `size` threads are busy, which the caller must never let happen
     */
    run(request) {
      if (closed) return Promise.resolve({ ok: false, reason: "closed" });
      const slot = slots.find((candidate) => candidate.job === undefined);
      if (slot === undefined) throw new RangeError("Every thinking thread is busy");
      if (slot.worker === undefined) spawn(slot);
      return new Promise((resolve) => {
        const id = (nextId += 1);
        const timer = setTimeout(() => fail(slot, "timeout"), budgetMs);
        slot.job = { id, resolve, timer };
        try {
          slot.worker.postMessage({ id, request });
        } catch (error) {
          finish(slot, { ok: false, reason: "failed", error });
        }
      });
    },

    /** Ends every think as `closed` and every thread, waiting at most `closeWithinMs`. Running it again does nothing. */
    async close() {
      if (closed) return;
      closed = true;
      const ending = slots.flatMap((slot) => {
        const { worker } = slot;
        slot.worker = undefined;
        finish(slot, { ok: false, reason: "closed" });
        return worker === undefined ? [] : [worker.terminate()];
      });
      let timer;
      const limit = new Promise((resolve) => {
        timer = setTimeout(resolve, closeWithinMs);
        timer.unref();
      });
      await Promise.race([Promise.all(ending), limit]);
      clearTimeout(timer);
    },
  });
}
