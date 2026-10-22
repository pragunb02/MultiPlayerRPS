import { endpointOf, ERROR_CODES } from "@classicade/shared";
import { NotFoundError } from "../../utils/errors.js";
import { toClientError } from "../errorTranslation.js";

/**
 * Turns unmatched routes into a NotFoundError so they flow through the same translation.
 *
 * @type {import("express").RequestHandler}
 */
export function notFoundHandler(req, res, next) {
  next(new NotFoundError("Not found"));
}

/**
 * Last middleware in the chain. Logs server faults with stack and cause; never leaks internals to clients.
 *
 * @type {import("express").ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by their 4-argument signature
export function errorHandler(err, req, res, next) {
  const { status, ...body } = toClientError(err);
  if (status >= 500) {
    req.log.error({ err }, "unhandled error");
  }
  res.locals.errorCode = body.code;
  res.status(status).json({ error: { ...body, requestId: req.id } });
}

const KNOWN_CODES = new Set(Object.values(ERROR_CODES));

/**
 * Counts each request that ends in a server fault as one anonymous `server_errored` (CC-175, EVENTS.md 3.5): the
 * API template it was for and the error code, never the path, the message or who asked. Then the error goes on to
 * the error handler unchanged.
 *
 * @param {{ record: (req: import("express").Request, name: string, fields: Record<string, string>) => void }} serverEvents
 * @returns {import("express").ErrorRequestHandler}
 */
export function countServerErrors(serverEvents) {
  return (err, req, res, next) => {
    const { status, code } = toClientError(err);
    if (status >= 500 && req.originalUrl.startsWith("/api/")) {
      serverEvents.record(req, "server_errored", {
        operation: endpointOf(req.originalUrl),
        code: KNOWN_CODES.has(code) ? code : "unknown",
      });
    }
    next(err);
  };
}
