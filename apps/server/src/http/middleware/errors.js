/** @type {import("express").RequestHandler} */
export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
}

/**
 * Last-resort handler: never leaks stack traces or internal messages to clients.
 * Structured logging replaces console.error in CC-012.
 *
 * @type {import("express").ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by their 4-argument signature
export function errorHandler(err, req, res, next) {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) {
    console.error(err);
  }
  const message = status >= 500 ? "Internal server error" : err.expose ? err.message : "Request failed";
  res.status(status).json({ error: { code: status >= 500 ? "INTERNAL" : "BAD_REQUEST", message } });
}
