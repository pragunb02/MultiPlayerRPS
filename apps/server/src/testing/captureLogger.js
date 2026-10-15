import { createLogger } from "../utils/logger.js";

/**
 * Test helper: a real logger (same redaction and serializers as production) that keeps
 * every log line in memory as a parsed object.
 *
 * @param {{ level?: string }} [options]
 */
export function captureLogger({ level = "trace" } = {}) {
  const entries = [];
  const destination = { write: (line) => entries.push(JSON.parse(line)) };
  const logger = createLogger({ level, destination });
  return {
    logger,
    entries,
    /** @param {string} msg */
    find: (msg) => entries.filter((entry) => entry.msg === msg),
  };
}
