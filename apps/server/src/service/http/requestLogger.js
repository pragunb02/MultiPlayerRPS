import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NO_OPERATIONS_METRICS, ROUTE_PATTERN, ROUTE_UNMATCHED } from "../../utils/operationsMetrics.js";

export const REQUEST_ID_HEADER = "X-Request-Id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** @param {number} status */
const levelFor = (status) => (status >= 500 ? "error" : status >= 400 ? "warn" : "info");

/**
 * How many addresses the X-Forwarded-For header holds. Only the count is logged, never the addresses. Comparing it
 * with TRUST_PROXY_HOPS on your own request shows whether the hop count matches the proxies in front of the server.
 *
 * @param {string | undefined} header
 */
const forwardedEntries = (header) =>
  header === undefined ? {} : { forwardedEntries: header.split(",").length };

/**
 * Remembers where the router that follows is mounted. Express forgets it (`req.baseUrl`) when a handler fails and
 * the error goes back up, so the route template would lose its prefix exactly on the requests that matter most.
 *
 * @type {import("express").RequestHandler}
 */
export const keepRoutePrefix = (req, res, next) => {
  res.locals.routePrefix = req.baseUrl;
  next();
};

/**
 * The route that answered, as written in the code: `/api/matches/:matchId`, never `/api/matches/3f25...`. A
 * request no route answered (a static file, an unknown address) is `unmatched`, and a route written as a pattern
 * or a list is `pattern`, because its text is not a template.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
function routeOf(req, res) {
  const template = req.route?.path;
  if (template === undefined) return ROUTE_UNMATCHED;
  if (typeof template !== "string") return ROUTE_PATTERN;
  return `${res.locals.routePrefix ?? ""}${template}`;
}

/**
 * Assigns every request an id (propagating a well-formed incoming `X-Request-Id`), attaches a child logger
 * as `req.log`, echoes the id in the response, and writes one access-log line when the response finishes. The
 * same moment, it tells operations telemetry the route template, method, status and time taken (ADR-055).
 *
 * @param {{
 *   logger: import("../../utils/logger.js").Logger,
 *   recordRequest?: import("../../utils/operationsMetrics.js").OperationsMetrics["recordHttpRequest"],
 *   generateId?: () => string,
 *   now?: () => number,
 * }} deps  `recordRequest` does nothing unless telemetry is on. `generateId` and `now` are injectable for
 *   deterministic tests.
 * @returns {import("express").RequestHandler}
 */
export function createRequestLogger({
  logger,
  recordRequest = NO_OPERATIONS_METRICS.recordHttpRequest,
  generateId = randomUUID,
  now = () => performance.now(),
}) {
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
      const durationMs = now() - startedAt;
      const route = routeOf(req, res);
      recordRequest({ route, method: req.method, status: res.statusCode, durationMs });
      req.log[levelFor(res.statusCode)](
        {
          method: req.method,
          path,
          route,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          ...forwardedEntries(req.get("X-Forwarded-For")),
          ...(res.locals.errorCode && { errorCode: res.locals.errorCode }),
        },
        "request completed",
      );
    });

    next();
  };
}
