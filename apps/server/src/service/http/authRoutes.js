import { Router } from "express";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { clientIpKey, createRateLimit } from "./rateLimits.js";
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

const TOO_MANY_ATTEMPTS = "Too many attempts, try again later";

/**
 * Accounts over HTTP. Logout is `DELETE /api/session`, "who am I" is `GET /api/session`.
 *
 *   POST /auth/signup  { username, email, password } → 201 { identity, carriedOver? }
 *   POST /auth/login   { email, password }           → 200 { identity, carriedOver? }
 *
 * Signing in replaces the current session (new id — no fixation) and disconnects sockets of the old one;
 * `onIdentityChanged` hears who the player was before (e.g. a guest whose seats and progress follow them, CC-083,
 * CC-032). `carriedOver` ({ xp, matchesPlayed, matches }) says what a guest's games brought to the account in
 * this request. Moving them never fails a sign-in: a failure is logged and finished later by housekeeping.
 *
 * @param {{
 *   accountComponent: ReturnType<typeof import("../../domain/accounts/accountComponent.js").createAccountComponent>,
 *   onSessionEnded: (sessionId: string) => void,
 *   onIdentityChanged: (change: { previous: import("../../models/identity.js").Identity | undefined, identity: import("../../models/identity.js").Identity }) => Promise<{ carriedOver?: { xp: number, matchesPlayed: number, matches: number } }>,
 *   now?: () => number,
 *   limits?: typeof DEFAULT_LIMITS,
 * }} deps
 */
export function createAuthRoutes({
  accountComponent,
  onSessionEnded,
  onIdentityChanged,
  now = Date.now,
  limits = DEFAULT_LIMITS,
}) {
  assertDefined(accountComponent, "accountComponent");
  assertFunction(onSessionEnded, "onSessionEnded");
  assertFunction(onIdentityChanged, "onIdentityChanged");
  const router = Router();

  const perIp = createRateLimit({ ...limits.perIp, message: TOO_MANY_ATTEMPTS });
  // Stops guessing one account's password from many IPs: only failed logins count, keyed by the email tried.
  const failedLoginsPerEmail = createRateLimit({
    ...limits.failedLoginsPerEmail,
    message: TOO_MANY_ATTEMPTS,
    skipSuccessfulRequests: true,
    headers: false,
    keyGenerator: (req) =>
      typeof req.body?.email === "string" ? `email:${req.body.email.trim().toLowerCase()}` : clientIpKey(req),
  });

  async function signIn(req, res, identity, status) {
    const previous = req.session.identity;
    const previousSessionId = previous === undefined ? "" : req.sessionID;
    await establishSession(req, identity);
    const { carriedOver } = await followIdentity(req, { previous, identity });
    if (previousSessionId !== "") {
      onSessionEnded(previousSessionId);
    }
    res.status(status).json({ identity, ...(carriedOver !== undefined && { carriedOver }) });
  }

  /** The player is signed in either way: what follows them (seats, progress) is best effort here. */
  async function followIdentity(req, change) {
    try {
      return await onIdentityChanged(change);
    } catch (err) {
      req.log.error(
        { err, playerId: change.identity.id, previousPlayerId: change.previous?.id },
        "moving the previous identity's data failed",
      );
      return {};
    }
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
