import session from "express-session";
import { createIdentity } from "../../models/identity.js";
import { UnauthorizedError } from "../../utils/errors.js";

export const SESSION_COOKIE_NAME = "cc.sid";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

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
export function establishSession(req, identity) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateErr) => {
      if (regenerateErr) {
        reject(regenerateErr);
        return;
      }
      req.session.identity = { ...identity };
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
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
