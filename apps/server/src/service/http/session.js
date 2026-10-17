import session from "express-session";
import { IDENTITY_KINDS } from "@classicade/shared";
import { createIdentity } from "../../models/identity.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { NotFoundError, UnauthorizedError } from "../../utils/errors.js";

export const SESSION_COOKIE_NAME = "cc.sid";
/**
 * Sessions last 30 days after the LAST visit (rolling, CC-096): a guest who keeps playing never loses their progress
 * to an expired cookie, and anyone who stays away for a month starts fresh.
 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * A signed-in session ends 90 days after signing in, however often it is used (CC-116). A stolen session cookie
 * therefore stops working within three months even if the thief keeps it busy, and the player only has to type
 * their password again about four times a year. Guest sessions have no such end: a guest has no password to sign
 * in with again, so ending their session would lose their progress.
 */
export const SESSION_ABSOLUTE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

/** Why the server ended a session, in the `details.reason` of the UnauthorizedError. */
export const SESSION_END_REASONS = Object.freeze({
  /** the password was changed or "sign out other devices" was used somewhere else */
  SIGNED_OUT: "signed-out",
  /** the session is older than SESSION_ABSOLUTE_LIFETIME_MS */
  EXPIRED: "expired",
});

/**
 * Cookie-backed server-side sessions. The same middleware instance is used by HTTP and the realtime
 * gateway, so a socket sees exactly the session (and identity) its browser has.
 *
 * @param {{ store: import("express-session").Store, secret: string, secureCookies: boolean }} options
 * @returns {import("express").RequestHandler}
 */
export function createSessionMiddleware({ store, secret, secureCookies }) {
  return session({
    name: SESSION_COOKIE_NAME,
    secret,
    store,
    resave: false,
    saveUninitialized: false, // no session (and no cookie) until there is an identity to remember
    // Every response re-issues the cookie with a fresh expiry; the store only rewrites its copy now and then
    // (see touchAfter in persistence/sessionStore.js), so a visit costs no database write.
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      maxAge: SESSION_TTL_SECONDS * 1000,
    },
  });
}

/**
 * The identity stored in a session, re-validated on every read: a session written by an older
 * version (or tampered with in the store) is treated as "no identity", never trusted blindly.
 *
 * @param {Partial<import("express-session").SessionData> | undefined} sessionData
 * @returns {Readonly<import("../../models/identity.js").Identity>}
 * @throws {UnauthorizedError} when the session holds no valid identity
 */
export function requireIdentity(sessionData) {
  const stored = sessionData?.identity;
  if (stored === undefined) {
    throw new UnauthorizedError("No active session");
  }
  try {
    return createIdentity(stored);
  } catch (err) {
    throw new UnauthorizedError("Session identity is invalid", { cause: err });
  }
}

/**
 * Stores an identity in a fresh session id (prevents session fixation: an id issued before
 * the identity existed is never promoted to carry it).
 *
 * @param {import("express").Request} req
 * @param {Readonly<import("../../models/identity.js").Identity>} identity
 * @returns {Promise<void>}
 */
export const establishSession = (req, identity) => regenerateWith(req, { identity: { ...identity } });

/** A fresh session id holding exactly `fields`, saved in one write. */
function regenerateWith(req, fields) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateErr) => {
      if (regenerateErr) {
        reject(regenerateErr);
        return;
      }
      Object.assign(req.session, fields);
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

/**
 * Stores an account's identity in a fresh session id, with the account's session version and the moment of
 * signing in, so the session can be ended later by "sign out other devices" or by its age (CC-116). The old id is
 * destroyed, so a copy of the old cookie no longer works.
 *
 * @param {import("express").Request} req
 * @param {{
 *   identity: Readonly<import("../../models/identity.js").Identity>,
 *   sessionVersion: number,
 *   signedInAt: number,
 * }} signIn
 * @returns {Promise<void>}
 */
export const establishAccountSession = (req, { identity, sessionVersion, signedInAt }) =>
  regenerateWith(req, { identity: { ...identity }, sessionVersion, signedInAt });

/** How long requests that were already on their way with a session id that was just renewed still pass. */
export const RENEWAL_GRACE_MS = 5_000;

/**
 * Session ids being renewed by their own player (a password change or "sign out other devices", CC-116). Another
 * request of the same browser can be on its way while the account's version moves on and the session gets its new
 * id. It still carries the old id and the old version, so the check would sign the browser out that just asked to
 * stay. For a few seconds such a request passes instead. The old id is already destroyed by then, so it cannot be
 * used again after that.
 *
 * @param {{ now: () => number, graceMs?: number }} deps
 */
export function createSessionRenewals({ now, graceMs = RENEWAL_GRACE_MS }) {
  /** @type {Map<string, number>} session id to the moment its grace ends */
  const renewing = new Map();
  return Object.freeze({
    /** @param {string} sessionId  about to get a new id */
    begin(sessionId) {
      for (const [id, until] of renewing) if (now() >= until) renewing.delete(id);
      renewing.set(sessionId, now() + graceMs);
    },
    /** @param {string} sessionId */
    isRenewing: (sessionId) => (renewing.get(sessionId) ?? 0) > now(),
  });
}

const signedOut = (cause) =>
  new UnauthorizedError("You were signed out on this device, please log in again", {
    details: { reason: SESSION_END_REASONS.SIGNED_OUT },
    ...(cause !== undefined && { cause }),
  });

/**
 * Whether a session may still be used, beyond holding a valid identity. A guest session always may. An account's
 * session may while its session version is the account's current one and it is younger than 90 days.
 *
 * Sessions made before CC-116 carry no version, and every account started at version 0, so they count as version
 * 0. They carry no sign-in time either. The HTTP check stamps the moment it first sees one, so its 90 days start
 * then.
 *
 * @param {{
 *   accountComponent: Pick<ReturnType<typeof import("../../domain/accounts/accountComponent.js").createAccountComponent>, "sessionVersionOf">,
 *   now: () => number,
 *   absoluteLifetimeMs?: number,
 * }} deps
 * @returns {(sessionData: Partial<import("express-session").SessionData>) => Promise<void>}
 *   resolves when the session may be used, and throws UnauthorizedError with `details.reason` when not
 */
export function createSessionCheck({
  accountComponent,
  now,
  absoluteLifetimeMs = SESSION_ABSOLUTE_LIFETIME_MS,
}) {
  assertDefined(accountComponent, "accountComponent");
  assertFunction(now, "now");
  return async (sessionData) => {
    const identity = requireIdentity(sessionData);
    if (identity.kind !== IDENTITY_KINDS.USER) {
      return;
    }
    if (sessionData.signedInAt !== undefined && now() - sessionData.signedInAt >= absoluteLifetimeMs) {
      throw new UnauthorizedError("Your session has expired, please log in again", {
        details: { reason: SESSION_END_REASONS.EXPIRED },
      });
    }
    let current;
    try {
      current = await accountComponent.sessionVersionOf({ playerId: identity.id });
    } catch (err) {
      // The account is gone, so no session of it may be used.
      if (err instanceof NotFoundError) throw signedOut(err);
      throw err;
    }
    if ((sessionData.sessionVersion ?? 0) !== current) {
      throw signedOut();
    }
  };
}

/**
 * Runs the session check on every API request. A session that may no longer be used is replaced by an empty one,
 * so the request goes on as a visitor without a session (GET /api/session answers `authenticated: false`), and the
 * old session's sockets are disconnected. A session with a broken identity is left alone here, for the routes to
 * refuse as before.
 *
 * @param {{
 *   checkSession: ReturnType<typeof createSessionCheck>,
 *   onSessionEnded: (sessionId: string) => void,
 *   renewals: ReturnType<typeof createSessionRenewals>,
 *   now: () => number,
 * }} deps
 * @returns {import("express").RequestHandler}
 */
export function createSessionGuard({ checkSession, onSessionEnded, renewals, now }) {
  assertFunction(checkSession, "checkSession");
  assertFunction(onSessionEnded, "onSessionEnded");
  assertDefined(renewals, "renewals");
  return async (req, res, next) => {
    if (!hasValidIdentity(req.session)) {
      next();
      return;
    }
    if (req.session.identity.kind === IDENTITY_KINDS.USER && req.session.signedInAt === undefined) {
      req.session.signedInAt = now();
    }
    try {
      await checkSession(req.session);
    } catch (err) {
      // Anything else, such as the database being down, is a server fault: Express answers it with a 500.
      if (!(err instanceof UnauthorizedError)) throw err;
      if (err.details.reason === SESSION_END_REASONS.SIGNED_OUT && renewals.isRenewing(req.sessionID)) {
        next();
        return;
      }
      const endedId = req.sessionID;
      const playerId = req.session.identity.id;
      await regenerateSession(req);
      onSessionEnded(endedId);
      req.log.info({ playerId, reason: err.details.reason }, "session ended by the server");
    }
    next();
  };
}

function hasValidIdentity(sessionData) {
  try {
    requireIdentity(sessionData);
    return true;
  } catch {
    return false;
  }
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * @param {import("express").Request} req
 * @returns {Promise<void>}
 */
export function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}
