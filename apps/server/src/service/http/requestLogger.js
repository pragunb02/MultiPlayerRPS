import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

export const REQUEST_ID_HEADER = "X-Request-Id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** @param {number} status */
const levelFor = (status) => (status >= 500 ? "error" : status >= 400 ? "warn" : "info");

/**
 * Assigns every request an id (propagating a well-formed incoming `X-Request-Id`), attaches a child logger
 * as `req.log`, echoes the id in the response, and writes one access-log line when the response finishes.
 *
 * @param {{
 *   logger: import("../../utils/logger.js").Logger,
 *   generateId?: () => string,
 *   now?: () => number,
 * }} deps  `generateId` and `now` are injectable for deterministic tests.
 * @returns {import("express").RequestHandler}
 */
export function createRequestLogger({ logger, generateId = randomUUID, now = () => performance.now() }) {
  return (req, res, next) => {
    const incomingId = req.get(REQUEST_ID_HEADER);
    const requestId = incomingId && REQUEST_ID_PATTERN.test(incomingId) ? incomingId : generateId();
    const startedAt = now();
    // Captured now: routers rewrite req.path/req.url while the request is being handled.
    const path = req.path;

    req.id = requestId;
    req.log = logger.child({ requestId });
    res.setHeader(REQUEST_ID_HEADER, requestId);

    res.on("finish", () => {
      req.log[levelFor(res.statusCode)](
        {
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Math.round((now() - startedAt) * 100) / 100,
          ...(res.locals.errorCode && { errorCode: res.locals.errorCode }),
        },
        "request completed",
      );
    });

    next();
  };
}
