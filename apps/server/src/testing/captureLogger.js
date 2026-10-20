import { createLogger } from "../utils/logger.js";

/**
 * Test helper: a real logger (same redaction and serializers as production) that keeps
 * every log line in memory as a parsed object.
 *
 * @param {{ level?: string }} [options]
 */
export function captureLogger({ level = "trace" } = {}) {
  const entries = [];
  const waiting = [];
  const destination = {
    write: (line) => {
      const entry = JSON.parse(line);
      entries.push(entry);
      for (const waiter of waiting.filter(({ msg }) => msg === entry.msg)) {
        waiting.splice(waiting.indexOf(waiter), 1);
        waiter.resolve(entry);
      }
    },
  };
  const logger = createLogger({ level, destination });
  return {
    logger,
    entries,
    /** @param {string} msg */
    find: (msg) => entries.filter((entry) => entry.msg === msg),
    /**
     * The first line with this message: at once when it was already written, else when it is. For work done in the
     * background, so a test waits for the work itself instead of polling on a timer (CC-309).
     *
     * @param {string} msg
     * @returns {Promise<object>}
     */
    once: (msg) =>
      new Promise((resolve) => {
        const written = entries.find((entry) => entry.msg === msg);
        if (written === undefined) waiting.push({ msg, resolve });
        else resolve(written);
      }),
  };
}
