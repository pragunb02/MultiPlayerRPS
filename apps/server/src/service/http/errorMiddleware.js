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
