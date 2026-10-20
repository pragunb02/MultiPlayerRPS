import { performance } from "node:perf_hooks";
import { ERROR_CODES } from "@classicade/shared";
import { NO_OPERATIONS_METRICS, SOCKET_OUTCOMES } from "../../utils/operationsMetrics.js";
import { toClientError } from "../errorTranslation.js";

const RATE_LIMITED = Object.freeze({
  ok: false,
  error: Object.freeze({ code: ERROR_CODES.RATE_LIMITED, message: "Slow down — too many requests" }),
});

/**
 * @typedef {{ ok: true, data: unknown } | { ok: false, error: { code: string, message: string, details?: object } }} Ack
 */

/**
 * Registers request/response style socket handlers. Every client event must carry an acknowledgement
 * callback and always gets exactly one reply in the standard shape. Errors are translated with the
 * same rules as HTTP (no internals leak), and server faults are logged. Each acknowledged event is timed for
 * operations telemetry by its name and how it ended (ADR-055).
 *
 * @param {import("socket.io").Socket} socket
 * @param {Record<string, (payload: unknown) => unknown | Promise<unknown>>} handlers
 * @param {import("../../utils/logger.js").Logger} logger
 * @param {{
 *   allow?: () => boolean,
 *   recordEvent?: import("../../utils/operationsMetrics.js").OperationsMetrics["recordSocketEvent"],
 *   now?: () => number,
 * }} [options]  `allow` is the rate-limit guard: a refused event is acknowledged with RATE_LIMITED. `recordEvent`
 *   does nothing unless telemetry is on. `now` is injectable for deterministic tests
 */
export function registerHandlers(
  socket,
  handlers,
  logger,
  {
    allow = () => true,
    recordEvent = NO_OPERATIONS_METRICS.recordSocketEvent,
    now = () => performance.now(),
  } = {},
) {
  for (const [event, handler] of Object.entries(handlers)) {
    socket.on(event, async (...args) => {
      const ack = args.at(-1);
      if (typeof ack !== "function") {
        logger.warn({ event }, "socket event without acknowledgement ignored");
        return;
      }
      const startedAt = now();
      const reply = (answer, outcome) => {
        ack(answer);
        recordEvent({ event, outcome, durationMs: now() - startedAt });
      };
      if (!allow()) {
        reply(RATE_LIMITED, SOCKET_OUTCOMES.RATE_LIMITED);
        return;
      }
      const payload = args.length > 1 ? args[0] : undefined;
      try {
        reply({ ok: true, data: await handler(payload) }, SOCKET_OUTCOMES.OK);
      } catch (err) {
        const { status, ...error } = toClientError(err);
        if (status >= 500) {
          logger.error({ err, event }, "socket handler failed");
        }
        reply({ ok: false, error }, status >= 500 ? SOCKET_OUTCOMES.FAILED : SOCKET_OUTCOMES.REFUSED);
      }
    });
  }
}
