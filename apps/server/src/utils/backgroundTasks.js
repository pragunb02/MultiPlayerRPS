/**
 * Runs work that must not slow down a request (e.g. writing a match after a game ends), logs failures, and
 * lets shutdown wait for everything still in flight.
 *
 * @param {{ logger: import("./logger.js").Logger }} deps
 */
export function createBackgroundTasks({ logger }) {
  const pending = new Set();

  return Object.freeze({
    /**
     * @param {string} name                 used in the failure log
     * @param {() => Promise<unknown>} task
     * @param {Record<string, unknown>} [context]  extra fields for the failure log
     */
    run(name, task, context = {}) {
      const running = Promise.resolve()
        .then(task)
        .catch((err) => logger.error({ err, task: name, ...context }, "background task failed"))
        .finally(() => pending.delete(running));
      pending.add(running);
    },

    /** Resolves once every task started so far — and any they started — has finished. */
    async drain() {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
    },
  });
}
