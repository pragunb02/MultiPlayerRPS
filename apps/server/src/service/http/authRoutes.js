import { Router } from "express";
import { normaliseEmail } from "../../models/credentials.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { AppError, ConflictError, UnauthorizedError, ValidationError } from "../../utils/errors.js";
import { dayOf } from "../../utils/indiaTime.js";
import { createLoginThrottle, LOGIN_THROTTLE } from "./loginThrottle.js";
import { clientIpKey, createRateLimit } from "./rateLimits.js";
import { establishAccountSession, requireIdentity } from "./session.js";

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

/**
 * Accounts over HTTP. Logout is `DELETE /api/session`, "who am I" is `GET /api/session`.
 *
 * 1. `POST /auth/signup` with `{ username, email, password, birthYear? }` answers 201 with `{ identity, carriedOver? }`.
 *    `birthYear` is left out when the player would rather not say (CC-152).
 * 2. `POST /auth/login` with `{ email, password }` answers 200 with `{ identity, carriedOver? }`.
 * 3. `POST /auth/password` with `{ currentPassword, newPassword }` answers 204, and other devices are signed out.
 * 4. `POST /auth/sign-out-others` with no body answers 204, and other devices are signed out.
 * 5. `POST /auth/suspended-export` with `{ email, password }` answers a suspended account's data as a JSON file
 *    (CC-334, ADR-078 decision 7), with the login's limits. A wrong password is the login's 401; an account that is
 *    not suspended is told to log in (409).
 *
 * A suspended account that logs in with the right password gets 403 with `details: { reason: "suspended", endsAt? }`
 * and no session (ADR-078 decision 3). A wrong password answers the usual 401, so nobody learns who is suspended.
 *
 * Signing in replaces the current session (new id — no fixation) and disconnects sockets of the old one;
 * `onIdentityChanged` hears who the player was before (e.g. a guest whose seats and progress follow them, CC-083,
 * CC-032). `carriedOver` ({ xp, matchesPlayed, matches }) says what a guest's games brought to the account in
 * this request. Moving them never fails a sign-in: a failure is logged and finished later by housekeeping.
 *
 * Changing the password and signing out other devices end every other session of the account (CC-116). This
 * session takes the new session version under a new id, so it stays signed in while a stolen copy of its old
 * cookie stops working, and `onOtherSessionsEnded` moves this browser's sockets to the new id and disconnects the
 * sockets of the others.
 *
 * @param {{
 *   accountComponent: ReturnType<typeof import("../../domain/accounts/accountComponent.js").createAccountComponent>,
 *   onSessionEnded: (sessionId: string) => void,
 *   onOtherSessionsEnded: (which: { playerId: string, fromSessionId: string, toSessionId: string }) => void,
 *   renewals: ReturnType<typeof import("./session.js").createSessionRenewals>,
 *   onIdentityChanged: (change: { previous: import("../../models/identity.js").Identity | undefined, identity: import("../../models/identity.js").Identity }) => Promise<{ carriedOver?: { xp: number, matchesPlayed: number, matches: number } }>,
 *   suspensionComponent: Pick<ReturnType<typeof import("../../domain/suspensions/suspensionComponent.js").createSuspensionComponent>, "refuseSignIn" | "isSuspended">,
 *   playerDataComponent: Pick<ReturnType<typeof import("../../domain/accounts/playerDataComponent.js").createPlayerDataComponent>, "exportFor">,
 *   now?: () => number,
 *   limits?: Partial<typeof DEFAULT_LIMITS>,   any limit not given keeps its standard value
 * }} deps
 */
export function createAuthRoutes({
  accountComponent,
  onSessionEnded,
  onOtherSessionsEnded,
  renewals,
  onIdentityChanged,
  suspensionComponent,
  playerDataComponent,
  now = Date.now,
  limits = {},
}) {
  assertFunction(suspensionComponent?.refuseSignIn, "suspensionComponent.refuseSignIn");
  assertFunction(suspensionComponent?.isSuspended, "suspensionComponent.isSuspended");
  assertFunction(playerDataComponent?.exportFor, "playerDataComponent.exportFor");
  assertDefined(accountComponent, "accountComponent");
  assertFunction(onSessionEnded, "onSessionEnded");
  assertFunction(onOtherSessionsEnded, "onOtherSessionsEnded");
  assertDefined(renewals, "renewals");
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
    await establishAccountSession(req, { identity, sessionVersion, signedInAt: now() });
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

  /**
   * `bump` counts the account's version up. This session then takes the new version under a new id and stays
   * signed in, and every other session is ended. The old id is marked as renewing first, so a request of this
   * browser that is on its way meanwhile is not signed out (see createSessionRenewals).
   */
  async function keepOnlyThisSession(req, { bump, signedInAt }) {
    const identity = requireIdentity(req.session);
    const fromSessionId = req.sessionID;
    renewals.begin(fromSessionId);
    const sessionVersion = await bump();
    await establishAccountSession(req, { identity, sessionVersion, signedInAt });
    onOtherSessionsEnded({ playerId: identity.id, fromSessionId, toSessionId: req.sessionID });
  }

  router.post("/auth/signup", perIp, signupPerIp, async (req, res) => {
    const { username, email, password, birthYear } = requireFields(req.body, [
      "username",
      "email",
      "password",
      "birthYear",
    ]);
    const signedUp = await accountComponent.signup({
      username,
      email,
      password,
      ...(birthYear !== undefined && { birthYear }),
      now: now(),
    });
    req.log.info({ playerId: signedUp.identity.id }, "account created");
    await signIn(req, res, signedUp, 201);
  });

  /** The login with its throttle: the same answers and the same work for every miss (CC-117, CC-245). */
  async function checkedLogin(req, { email, password }) {
    const attempt = { email: normaliseEmail(email), address: clientIpKey(req) };
    await loginThrottle.before(attempt);
    let loggedIn;
    try {
      loggedIn = await accountComponent.login({ email, password, now: now() });
    } catch (err) {
      if (err instanceof UnauthorizedError) loginThrottle.failed(attempt);
      // A store that failed behind the login answers like a wrong password, so the answer says nothing about the
      // email. The failure itself is logged, without the email, so it is not missed (CC-245).
      if (err instanceof UnauthorizedError && err.cause !== undefined && !(err.cause instanceof AppError)) {
        req.log.error({ err: err.cause }, "the legacy store failed behind a login");
      }
      throw err;
    }
    loginThrottle.succeeded(attempt);
    return loggedIn;
  }

  router.post("/auth/login", perIp, async (req, res) => {
    const { email, password } = requireFields(req.body, ["email", "password"]);
    const loggedIn = await checkedLogin(req, { email, password });
    // The password was right: a suspended account is told when it may come back, and gets no session (ADR-078).
    try {
      await suspensionComponent.refuseSignIn({ playerId: loggedIn.identity.id, now: now() });
    } catch (err) {
      req.log.info({ playerId: loggedIn.identity.id }, "sign-in refused: the account is suspended");
      throw err;
    }
    req.log.info({ playerId: loggedIn.identity.id }, "logged in");
    if (loggedIn.legacyFailure !== undefined) {
      req.log.error({ err: loggedIn.legacyFailure }, "the legacy store failed behind a login");
    }
    // An account stored under an older email spelling is rewritten at its login (CC-245). The logs never hold the
    // email, only that it happened, and a warning when another account already had the new spelling.
    if (loggedIn.emailUpdate === "rewritten") {
      req.log.info({ playerId: loggedIn.identity.id }, "stored email rewritten to the one spelling");
    } else if (loggedIn.emailUpdate === "collision") {
      req.log.warn(
        { playerId: loggedIn.identity.id },
        "stored email left in an older spelling: another account already has the one spelling",
      );
    }
    await signIn(req, res, loggedIn, 200);
  });

  // A suspended account has no session, so its export asks for the email and password again (ADR-078).
  router.post("/auth/suspended-export", perIp, async (req, res) => {
    const { email, password } = requireFields(req.body, ["email", "password"]);
    const { identity } = await checkedLogin(req, { email, password });
    const at = now();
    if (!(await suspensionComponent.isSuspended({ playerId: identity.id, now: at }))) {
      throw new ConflictError("This account isn't paused. Log in to download your data from your profile");
    }
    const exported = await playerDataComponent.exportFor({ playerId: identity.id, password, now: at });
    req.log.info({ playerId: identity.id }, "data exported while suspended");
    res.set("Cache-Control", "no-store");
    res.attachment(`classicade-data-${dayOf(at)}.json`);
    res.json(exported);
  });

  router.post("/auth/password", perIp, failedPasswordChanges, async (req, res) => {
    const { currentPassword, newPassword } = requireFields(req.body, ["currentPassword", "newPassword"]);
    const { id: playerId } = requireIdentity(req.session);
    // Knowing the password is a new sign-in, so the 90 days start again.
    await keepOnlyThisSession(req, {
      bump: () => accountComponent.changePassword({ playerId, currentPassword, newPassword }),
      signedInAt: now(),
    });
    req.log.info({ playerId }, "password changed, other sessions signed out");
    res.status(204).end();
  });

  router.post("/auth/sign-out-others", perIp, async (req, res) => {
    requireNoFields(req.body);
    const { id: playerId } = requireIdentity(req.session);
    // No password was given, so the session keeps its 90 days instead of starting them again.
    await keepOnlyThisSession(req, {
      bump: () => accountComponent.signOutOtherDevices({ playerId }),
      signedInAt: req.session.signedInAt,
    });
    req.log.info({ playerId }, "other sessions signed out");
    res.status(204).end();
  });

  return router;
}
