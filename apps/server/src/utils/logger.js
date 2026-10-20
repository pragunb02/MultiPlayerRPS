import pino from "pino";

export const LOG_LEVELS = Object.freeze(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

// Secrets and personal data never reach the logs, wherever they appear in a logged object.
const REDACTED_KEYS = ["password", "token", "accessToken", "refreshToken", "sessionId", "email", "secret"];
const REDACT_PATHS = [
  ...REDACTED_KEYS,
  ...REDACTED_KEYS.map((key) => `*.${key}`),
  "headers.cookie",
  "headers.authorization",
  'headers["set-cookie"]',
  "*.headers.cookie",
  "*.headers.authorization",
];

/**
 * @typedef {import("pino").Logger} Logger
 */

/**
 * Creates the structured (JSON) logger. Pipe through `npx pino-pretty` for human-readable local output.
 *
 * @param {{ level: string, destination?: import("pino").DestinationStream, forward?: import("pino").DestinationStream }} options
 *   `destination` defaults to stdout, and tests pass an in-memory stream. `forward`, when given, also receives every
 *   line at info level and above, after redaction. Operations telemetry passes its log forwarder here (ADR-055).
 * @returns {Logger}
 */
export function createLogger({ level, destination, forward }) {
  const stdout = destination ?? pino.destination(1);
  return pino(
    {
      level,
      base: { service: "classicade-server" },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      serializers: { err: pino.stdSerializers.errWithCause },
    },
    forward === undefined
      ? stdout
      : pino.multistream([
          { level: "trace", stream: stdout },
          { level: "info", stream: forward },
        ]),
  );
}
