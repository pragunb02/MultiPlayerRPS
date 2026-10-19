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
  watch: nothing,
});
