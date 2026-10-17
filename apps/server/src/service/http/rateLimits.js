import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { ERROR_CODES } from "@classicade/shared";

/** One minute, 300 requests: plenty for a player clicking around, far too few for a script. */
export const DEFAULT_API_LIMIT = Object.freeze({ windowMs: 60 * 1000, limit: 300 });

/**
 * The rate limit key for the player's network address. `req.ip` is the address the trusted proxies saw, so it
 * follows the `trust proxy` hop count set on the app. IPv6 addresses are grouped by their /56 network, because
 * one home connection usually owns a whole block of them.
 *
 * @param {import("express").Request} req
 * @returns {string}
 */
export const clientIpKey = (req) => `ip:${ipKeyGenerator(/** @type {string} */ (req.ip))}`;

/**
 * The rate limit key for the app-wide limit. A player with a session gets their own budget, so players behind one
 * shared network address (a school, an office, a mobile carrier) do not use up each other's requests. Requests
 * without a session fall back to the network address.
 *
 * @param {import("express").Request} req
 * @returns {string}
 */
export const sessionOrIpKey = (req) =>
  req.session.identity === undefined ? clientIpKey(req) : `session:${req.sessionID}`;

/**
 * An Express rate limiter that answers with the standard error body and the standard `RateLimit` headers.
 * Every limiter in the HTTP API is built here, so they all count the same client the same way.
 *
 * @param {{
 *   windowMs: number,
 *   limit: number,
 *   message: string,
 *   keyGenerator?: (req: import("express").Request) => string,
 *   skip?: (req: import("express").Request) => boolean,
 *   skipSuccessfulRequests?: boolean,
 *   headers?: boolean,
 * }} options  `keyGenerator` defaults to the client address. `headers` is off for a second limiter on the same
 *   route, so the two do not write over each other's headers.
 * @returns {import("express").RequestHandler}
 */
export function createRateLimit({
  windowMs,
  limit,
  message,
  keyGenerator = clientIpKey,
  skip = () => false,
  skipSuccessfulRequests = false,
  headers = true,
}) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    skip,
    skipSuccessfulRequests,
    standardHeaders: headers ? "draft-7" : false,
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        error: { code: ERROR_CODES.RATE_LIMITED, message, requestId: req.id },
      }),
  });
}

/**
 * One budget for every request under `/api`, counted per session or per address (see `sessionOrIpKey`). The
 * stricter limits on single routes still apply on top of it. The API health check is never limited, because the
 * hosting platform and uptime monitors call it often.
 *
 * @param {{ windowMs: number, limit: number }} limit
 * @returns {import("express").RequestHandler}
 */
export const createApiRateLimit = ({ windowMs, limit }) =>
  createRateLimit({
    windowMs,
    limit,
    message: "Too many requests, try again later",
    keyGenerator: sessionOrIpKey,
    skip: (req) => req.path === "/health",
  });
