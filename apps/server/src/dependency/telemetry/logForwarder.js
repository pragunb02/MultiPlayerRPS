// pino's level numbers and the OpenTelemetry severity numbers for the same levels.
const SEVERITIES = Object.freeze([
  { level: 60, severityNumber: 21, severityText: "FATAL" },
  { level: 50, severityNumber: 17, severityText: "ERROR" },
  { level: 40, severityNumber: 13, severityText: "WARN" },
  { level: 30, severityNumber: 9, severityText: "INFO" },
]);
// pino writes the level first and the message last, so both can be read without parsing the whole line.
const LEVEL_PREFIX = /^\{"level":(\d+),/;
const MESSAGE_SUFFIX = /,"msg":"([^"\\]*)"\}\s*$/;
const MAX_PER_MINUTE = 30;
const MINUTE_MS = 60_000;

/**
 * @typedef {{
 *   severityNumber: number,
 *   severityText: string,
 *   body: string,
 *   attributes: Record<string, unknown>,
 *   timestamp: Date,
 * }} ForwardedLog
 */

/**
 * The second stream of the logger (ADR-055 point 1.7). pino writes every line at info level and above to it as
 * JSON, and it keeps a line only when its message is a named line at or above that line's level. The level and
 * the message are read from the two ends of the line first, so the many lines that are not named (one per
 * request) cost a regular expression, not a parse. Of a named line it copies only the fields on the list, and of
 * an error only its class (`err.type`), never its message or stack, because a database error's message can hold
 * an email. Values are copied as they are: the scrubber checks them before export and counts any that break a
 * rule.
 *
 * The same line is sent at most 30 times a minute. A failing database can write the same error for every request,
 * and the first 30 say all there is to say. Each line held back is counted (`onSuppressed`), so the dashboard
 * shows that it happened. The full line always still goes to stdout.
 *
 * @param {{
 *   schema: ReturnType<typeof import("./telemetrySchema.js").createTelemetrySchema>,
 *   emit: (record: ForwardedLog) => void,   hands the record to the Logs SDK
 *   onSuppressed?: () => void,
 *   now?: () => number,
 * }} deps
 * @returns {{ write: (line: string) => void }}
 */
export function createLogForwarder({ schema, emit, onSuppressed = () => undefined, now = Date.now }) {
  const { lines, fields } = schema.logs;
  const fieldNames = Object.keys(fields).filter((name) => name !== "error.type");
  const windows = new Map();

  /** Whether one more of this line may go now, counting it if it may. */
  function allow(message) {
    const at = now();
    const window = windows.get(message);
    if (window === undefined || at - window.startedAt >= MINUTE_MS) {
      windows.set(message, { startedAt: at, sent: 1 });
      return true;
    }
    window.sent += 1;
    return window.sent <= MAX_PER_MINUTE;
  }

  return Object.freeze({
    write(line) {
      const level = Number(LEVEL_PREFIX.exec(line)?.[1]);
      const message = MESSAGE_SUFFIX.exec(line)?.[1];
      const lowest = message === undefined || !Object.hasOwn(lines, message) ? undefined : lines[message];
      if (lowest === undefined || !(level >= lowest)) return;
      const entry = parse(line);
      // The ends of a line can only look like a named line when the whole line is one: anything else fails here.
      if (entry?.msg !== message || entry.level !== level) return;
      if (!allow(message)) {
        onSuppressed();
        return;
      }
      const { severityNumber, severityText } = SEVERITIES.find((severity) => level >= severity.level);
      const attributes = {};
      for (const name of fieldNames) {
        if (Object.hasOwn(entry, name)) attributes[name] = entry[name];
      }
      if (entry.err?.type !== undefined) attributes["error.type"] = entry.err.type;
      emit({ severityNumber, severityText, body: message, attributes, timestamp: new Date(entry.time) });
    },
  });
}

/** @param {string} line @returns {Record<string, any> | undefined} */
function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
