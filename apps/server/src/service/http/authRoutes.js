import { Router } from "express";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { UnauthorizedError, ValidationError } from "../../utils/errors.js";
import { createLoginThrottle, LOGIN_THROTTLE } from "./loginThrottle.js";
import { clientIpKey, createRateLimit } from "./rateLimits.js";
import { establishAccountSession, requireIdentity, saveSession } from "./session.js";

const MINUTE_MS = 60 * 1000;

/**
 * The limits on the account routes. Each is a business rule, and tests and browser tests may change them.
 *
 * 1. `perIp`: every sign-up, login, password change and "sign out other devices" from one address together.
 * 2. `signupPerIp`: sign-ups from one address in an hour (CC-118). Signing up shows whether an email is taken, so
 *    this keeps anyone from checking a long list of emails. A family or a class signing up together stays inside.
 * 3. `failedLogins`: how wrong passwords are slowed down and stopped (CC-117, see loginThrottle.js).
 * 4. `failedPasswordChanges`: wrong current passwords per account (CC-116), so a borrowed signed-in browser cannot
 *    be used to guess the password.
 */
const DEFAULT_LIMITS = Object.freeze({
  perIp: Object.freeze({ windowMs: 15 * MINUTE_MS, limit: 20 }),
  signupPerIp: Object.freeze({ windowMs: 60 * MINUTE_MS, limit: 10 }),
  failedLogins: LOGIN_THROTTLE,
  failedPasswordChanges: Object.freeze({ windowMs: 15 * MINUTE_MS, limit: 5 }),
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

/** A request with no body at all, or an empty JSON object, so nothing unexpected is silently ignored. */
function requireNoFields(body) {
  if (body !== undefined) {
    requireFields(body, []);
  }
}

const TOO_MANY_ATTEMPTS = "Too many attempts, try again later";
const normalisedEmail = (email) => (typeof email === "string" ? email.trim().toLowerCase() : "");

/**
 * Accounts over HTTP. Logout is `DELETE /api/session`, "who am I" is `GET /api/session`.
 *
 * 1. `POST /auth/signup` with `{ username, email, password }` answers 201 with `{ identity, carriedOver? }`.
 * 2. `POST /auth/login` with `{ email, password }` answers 200 with `{ identity, carriedOver? }`.
 * 3. `POST /auth/password` with `{ currentPassword, newPassword }` answers 204, and other devices are signed out.
 * 4. `POST /auth/sign-out-others` with no body answers 204, and other devices are signed out.
 *
 * Signing in replaces the current session (new id — no fixation) and disconnects sockets of the old one;
 * `onIdentityChanged` hears who the player was before (e.g. a guest whose seats and progress follow them, CC-083,
 * CC-032). `carriedOver` ({ xp, matchesPlayed, matches }) says what a guest's games brought to the account in
 * this request. Moving them never fails a sign-in: a failure is logged and finished later by housekeeping.
 *
 * Changing the password and signing out other devices end every other session of the account (CC-116). This
 * session takes the new session version, so it stays signed in, and `onOtherSessionsEnded` disconnects the
 * sockets of the others.
 *
 * @param {{
 *   accountComponent: ReturnType<typeof import("../../domain/accounts/accountComponent.js").createAccountComponent>,
 *   onSessionEnded: (sessionId: string) => void,
 *   onOtherSessionsEnded: (which: { playerId: string, keepSessionId: string }) => void,
 *   onIdentityChanged: (change: { previous: import("../../models/identity.js").Identity | undefined, identity: import("../../models/identity.js").Identity }) => Promise<{ carriedOver?: { xp: number, matchesPlayed: number, matches: number } }>,
 *   now?: () => number,
 *   limits?: Partial<typeof DEFAULT_LIMITS>,   any limit not given keeps its standard value
 * }} deps
 */
export function createAuthRoutes({
  accountComponent,
  onSessionEnded,
  onOtherSessionsEnded,
  onIdentityChanged,
  now = Date.now,
  limits = {},
}) {
  assertDefined(accountComponent, "accountComponent");
  assertFunction(onSessionEnded, "onSessionEnded");
  assertFunction(onOtherSessionsEnded, "onOtherSessionsEnded");
  assertFunction(onIdentityChanged, "onIdentityChanged");
  const rules = { ...DEFAULT_LIMITS, ...limits };
  const router = Router();

  const perIp = createRateLimit({ ...rules.perIp, message: TOO_MANY_ATTEMPTS });
  const signupPerIp = createRateLimit({ ...rules.signupPerIp, message: TOO_MANY_ATTEMPTS, headers: false });
  const loginThrottle = createLoginThrottle({ limits: rules.failedLogins, now });
  const failedPasswordChanges = createRateLimit({
    ...rules.failedPasswordChanges,
    message: TOO_MANY_ATTEMPTS,
    skipSuccessfulRequests: true,
    headers: false,
    keyGenerator: (req) =>
      req.session.identity === undefined ? clientIpKey(req) : `player:${req.session.identity.id}`,
  });

  async function signIn(req, res, { identity, sessionVersion }, status) {
    const previous = req.session.identity;
    const previousSessionId = previous === undefined ? "" : req.sessionID;
    await establishAccountSession(req, { identity, sessionVersion, now: now() });
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

  /** This session takes the account's new version and stays signed in. Every other one is ended. */
  async function keepOnlyThisSession(req, sessionVersion) {
    req.session.sessionVersion = sessionVersion;
    await saveSession(req);
    onOtherSessionsEnded({ playerId: req.session.identity.id, keepSessionId: req.sessionID });
  }

  router.post("/auth/signup", perIp, signupPerIp, async (req, res) => {
    const { username, email, password } = requireFields(req.body, ["username", "email", "password"]);
    const signedUp = await accountComponent.signup({ username, email, password, now: now() });
    req.log.info({ playerId: signedUp.identity.id }, "account created");
    await signIn(req, res, signedUp, 201);
  });

  router.post("/auth/login", perIp, async (req, res) => {
    const { email, password } = requireFields(req.body, ["email", "password"]);
    const attempt = { email: normalisedEmail(email), address: clientIpKey(req) };
    await loginThrottle.before(attempt);
    let loggedIn;
    try {
      loggedIn = await accountComponent.login({ email, password, now: now() });
    } catch (err) {
      if (err instanceof UnauthorizedError) loginThrottle.failed(attempt);
      throw err;
    }
    loginThrottle.succeeded(attempt);
    req.log.info({ playerId: loggedIn.identity.id }, "logged in");
    await signIn(req, res, loggedIn, 200);
  });

  router.post("/auth/password", perIp, failedPasswordChanges, async (req, res) => {
    const { currentPassword, newPassword } = requireFields(req.body, ["currentPassword", "newPassword"]);
    const { id: playerId } = requireIdentity(req.session);
    const sessionVersion = await accountComponent.changePassword({ playerId, currentPassword, newPassword });
    await keepOnlyThisSession(req, sessionVersion);
    req.log.info({ playerId }, "password changed, other sessions signed out");
    res.status(204).end();
  });

  router.post("/auth/sign-out-others", perIp, async (req, res) => {
    requireNoFields(req.body);
    const { id: playerId } = requireIdentity(req.session);
    const sessionVersion = await accountComponent.signOutOtherDevices({ playerId });
    await keepOnlyThisSession(req, sessionVersion);
    req.log.info({ playerId }, "other sessions signed out");
    res.status(204).end();
  });

  return router;
}
