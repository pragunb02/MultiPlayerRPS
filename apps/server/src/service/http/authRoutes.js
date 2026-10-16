import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { ERROR_CODES } from "@classicade/shared";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { establishSession } from "./session.js";

const DEFAULT_LIMITS = Object.freeze({
  perIp: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 20 }),
  failedLoginsPerEmail: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 5 }),
});

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/** Shape-only edge validation: an object with exactly the allowed string fields. Content rules live in the models. */
function requireFields(body, fields) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Send a JSON object");
  }
  const unknown = Object.keys(body).filter((key) => !fields.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError("Unknown fields in payload", { details: { fields: unknown } });
  }
  return body;
}

const tooMany = (req, res) =>
  res.status(429).json({
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: "Too many attempts, try again later",
      requestId: req.id,
    },
  });

/**
 * Accounts over HTTP. Logout is `DELETE /api/session`, "who am I" is `GET /api/session`.
 *
 *   POST /auth/signup  { username, email, password } → 201 { identity }
 *   POST /auth/login   { email, password }           → 200 { identity }
 *
 * Signing in replaces the current session (new id — no fixation) and disconnects sockets of the old one.
 *
 * @param {{
 *   accountComponent: ReturnType<typeof import("../../domain/accounts/accountComponent.js").createAccountComponent>,
 *   onSessionEnded: (sessionId: string) => void,
 *   now?: () => number,
 *   limits?: typeof DEFAULT_LIMITS,
 * }} deps
 */
export function createAuthRoutes({
  accountComponent,
  onSessionEnded,
  now = Date.now,
  limits = DEFAULT_LIMITS,
}) {
  assertDefined(accountComponent, "accountComponent");
  assertFunction(onSessionEnded, "onSessionEnded");
  const router = Router();

  const perIp = rateLimit({
    ...limits.perIp,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: tooMany,
  });
  // Stops guessing one account's password from many IPs: only failed logins count, keyed by the email tried.
  const failedLoginsPerEmail = rateLimit({
    ...limits.failedLoginsPerEmail,
    skipSuccessfulRequests: true,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) =>
      typeof req.body?.email === "string"
        ? `email:${req.body.email.trim().toLowerCase()}`
        : ipKeyGenerator(req.ip),
    handler: tooMany,
  });

  async function signIn(req, res, identity, status) {
    const previousSessionId = req.session.identity === undefined ? "" : req.sessionID;
    await establishSession(req, identity);
    if (previousSessionId !== "") {
      onSessionEnded(previousSessionId);
    }
    res.status(status).json({ identity });
  }

  router.post("/auth/signup", perIp, async (req, res) => {
    const { username, email, password } = requireFields(req.body, ["username", "email", "password"]);
    const identity = await accountComponent.signup({ username, email, password, now: now() });
    req.log.info({ playerId: identity.id }, "account created");
    await signIn(req, res, identity, 201);
  });

  router.post("/auth/login", perIp, failedLoginsPerEmail, async (req, res) => {
    const { email, password } = requireFields(req.body, ["email", "password"]);
    const identity = await accountComponent.login({ email, password, now: now() });
    req.log.info({ playerId: identity.id }, "logged in");
    await signIn(req, res, identity, 200);
  });

  return router;
}
