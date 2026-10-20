/**
 * @typedef {Object} BotThinkingSettings   where computer players think (ADR-067)
 * @property {number} workers     worker threads for heavy thinking, from 1 to MAX_THINKING_WORKERS
 * @property {number} budgetMs    how long one think may run on a worker before the room gets a quick move instead
 */

/** More threads than this only add memory: a 512 MB plan has one or two cores, and the event loop needs one. */
export const MAX_THINKING_WORKERS = 4;

/**
 * The hard limit on one think. A Strong chess search takes about 0.2 s on a full core and 8 to 16 s under Render
 * Free's 0.1 CPU quota (measured in Docker, docs/tickets/CC-308.md), so only a stuck or runaway think reaches it.
 */
export const THINKING_BUDGET_MS = 30_000;

/**
 * One worker for each core but the event loop's, at least one and at most MAX_THINKING_WORKERS. There is no env
 * var: the number comes from the machine. Node reads a container's CPU quota, so every Render size up to Pro gets
 * one worker (docs/tickets/CC-308.md, research 1.8).
 *
 * @param {{ parallelism: number }} machine  `os.availableParallelism()`
 * @returns {Readonly<BotThinkingSettings>}
 */
export function botThinkingSettings({ parallelism }) {
  const spare = Number.isInteger(parallelism) ? parallelism - 1 : 0;
  return Object.freeze({
    workers: Math.min(MAX_THINKING_WORKERS, Math.max(1, spare)),
    budgetMs: THINKING_BUDGET_MS,
  });
}
