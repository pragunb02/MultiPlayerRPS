import { ERROR_CODES } from "@classicade/shared";
import { AppError, NotFoundError } from "../../utils/errors.js";

/** The one place where error codes become HTTP statuses. */
const STATUS_BY_CODE = Object.freeze({
  [ERROR_CODES.VALIDATION_FAILED]: 400,
  [ERROR_CODES.BAD_REQUEST]: 400,
  [ERROR_CODES.UNAUTHORIZED]: 401,
  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.PAYLOAD_TOO_LARGE]: 413,
});

const INTERNAL = Object.freeze({ status: 500, code: ERROR_CODES.INTERNAL, message: "Internal server error" });

/**
 * @typedef {Object} HttpError
 * @property {number} status
 * @property {string} code
 * @property {string} message
 * @property {Readonly<Record<string, unknown>>} [details]
 */

/**
 * Translates any thrown value into what the client may see. Only typed application errors and the
 * body parser's own client errors are exposed; everything else becomes a generic 500.
 *
 * @param {unknown} err
 * @returns {HttpError}
 */
export function toHttpError(err) {
  if (err instanceof AppError) {
    const status = STATUS_BY_CODE[err.code];
    if (status === undefined) {
      return INTERNAL;
    }
    const hasDetails = Object.keys(err.details).length > 0;
    return { status, code: err.code, message: err.message, ...(hasDetails && { details: err.details }) };
  }
  if (isBodyParserError(err)) {
    return err.type === "entity.too.large"
      ? { status: 413, code: ERROR_CODES.PAYLOAD_TOO_LARGE, message: "Request body is too large" }
      : { status: 400, code: ERROR_CODES.BAD_REQUEST, message: "Malformed request body" };
  }
  return INTERNAL;
}

/** @param {any} err */
function isBodyParserError(err) {
  return typeof err?.type === "string" && err.expose === true && err.status >= 400 && err.status < 500;
}

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
  const { status, ...body } = toHttpError(err);
  if (status >= 500) {
    req.log.error({ err }, "unhandled error");
  }
  res.locals.errorCode = body.code;
  res.status(status).json({ error: { ...body, requestId: req.id } });
}
