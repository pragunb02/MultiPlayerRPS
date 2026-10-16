import { ERROR_CODES } from "@classicade/shared";
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
 * callback and always gets exactly one reply in the standard shape; errors are translated with the
 * same rules as HTTP (no internals leak), and server faults are logged.
 *
 * @param {import("socket.io").Socket} socket
 * @param {Record<string, (payload: unknown) => unknown | Promise<unknown>>} handlers
 * @param {import("../../utils/logger.js").Logger} logger
 * @param {{ allow?: () => boolean }} [options]  rate-limit guard; a refused event is acknowledged with RATE_LIMITED
 */
export function registerHandlers(socket, handlers, logger, { allow = () => true } = {}) {
  for (const [event, handler] of Object.entries(handlers)) {
    socket.on(event, async (...args) => {
      const ack = args.at(-1);
      if (typeof ack !== "function") {
        logger.warn({ event }, "socket event without acknowledgement ignored");
        return;
      }
      if (!allow()) {
        ack(RATE_LIMITED);
        return;
      }
      const payload = args.length > 1 ? args[0] : undefined;
      try {
        ack({ ok: true, data: await handler(payload) });
      } catch (err) {
        const { status, ...error } = toClientError(err);
        if (status >= 500) {
          logger.error({ err, event }, "socket handler failed");
        }
        ack({ ok: false, error });
      }
    });
  }
}
