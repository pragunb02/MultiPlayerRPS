/**
 * The words the service layer and operations telemetry share (ADR-055). The service layer records what happened
 * with these, and telemetry (in `dependency/telemetry/`) decides what leaves. Neither imports the other: the
 * composition root hands the service layer the methods it needs.
 */

/** How one socket event ended. A typed error the player caused is `refused`, a fault of ours is `failed`. */
export const SOCKET_OUTCOMES = Object.freeze({
  OK: "ok",
  REFUSED: "refused",
  FAILED: "failed",
  RATE_LIMITED: "rate_limited",
});

/**
 * How a computer player's thinking ended (ADR-067). `timeout` and `crashed` gave the room the easiest level's move
 * instead, and `failed` is the strategy throwing.
 */
export const BOT_THINKING_OUTCOMES = Object.freeze({
  OK: "ok",
  TIMEOUT: "timeout",
  CRASHED: "crashed",
  FAILED: "failed",
});

/**
 * Why telemetry was not stored (CC-175), the one attribute of the ops counter `telemetry.dropped`. Only the reason
 * and how many leave the server, never anything about the event or who sent it. A whole batch dropped before its
 * body is read counts one. `invalid` and `cap` count events.
 */
export const TELEMETRY_DROP_REASONS = Object.freeze({
  OPTED_OUT: "opted_out",
  ADMIN: "admin",
  INVALID: "invalid",
  RATE_LIMITED: "rate_limited",
  CAP: "cap",
  BOT: "bot",
  FLAG_OFF: "flag_off",
});

/** How one day of the nightly telemetry rollup ended (CC-176), the one attribute of `telemetry_rollup.runs`. */
export const TELEMETRY_ROLLUP_OUTCOMES = Object.freeze({ OK: "ok", FAILED: "failed" });

/** The steps a rollup can fail at (CC-176), the `step` of the named line `telemetry rollup failed`. */
export const TELEMETRY_ROLLUP_STEPS = Object.freeze(["lock", "read", "total", "write", "finish"]);

/** The route of a request no route answered: a static file or an unknown address. */
export const ROUTE_UNMATCHED = "unmatched";

/** The route of a request answered by a route written as a pattern, such as the web app's page catch-all. */
export const ROUTE_PATTERN = "pattern";

/**
 * @typedef {Object} OperationsMetrics   what the rest of the server may tell telemetry, and nothing more
 * @property {(request: { route: string, method: string, status: number, durationMs: number }) => void} recordHttpRequest
 *   one finished request. `route` is the matched route template, never the path
 * @property {(event: { event: string, outcome: string, durationMs: number }) => void} recordSocketEvent
 *   one acknowledged socket event. `outcome` is a SOCKET_OUTCOMES value
 * @property {(attempt: { step: string, failedForGood: boolean }) => void} recordPipelineStep
 *   one attempt at one match pipeline step
 * @property {(thinking: { game: string, outcome: string, durationMs: number }) => void} recordBotThinking
 *   one computer player's think, from the ask to the answer. `game` is a catalogue id, `outcome` a
 *   BOT_THINKING_OUTCOMES value
 * @property {(drop: { reason: string, count: number }) => void} recordTelemetryDropped
 *   telemetry not stored (CC-175). `reason` is a TELEMETRY_DROP_REASONS value
 * @property {(run: { outcome: string }) => void} recordTelemetryRollup
 *   one day of the nightly rollup (CC-176). `outcome` is a TELEMETRY_ROLLUP_OUTCOMES value
 * @property {(readers: {
 *   rooms: () => Promise<ReadonlyArray<{ gameId: string, status: string, rooms: number }>>,
 *   connections: () => number,
 * }) => void} watch
 *   readers for the gauges, called only when a reading is due
 */

const nothing = () => undefined;

/** Operations metrics while telemetry is off: every method does nothing. */
export const NO_OPERATIONS_METRICS = Object.freeze({
  recordHttpRequest: nothing,
  recordSocketEvent: nothing,
  recordPipelineStep: nothing,
  recordBotThinking: nothing,
  recordTelemetryDropped: nothing,
  recordTelemetryRollup: nothing,
  watch: nothing,
});
