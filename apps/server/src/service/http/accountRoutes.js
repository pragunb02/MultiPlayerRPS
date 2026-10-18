import { Router } from "express";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { dayOf } from "../../utils/indiaTime.js";
import { createRateLimit } from "./rateLimits.js";
import { destroySession, requireIdentity, SESSION_COOKIE_NAME } from "./session.js";

const MINUTE_MS = 60 * 1000;
const TOO_MANY = "Too many attempts, try again later";

/**
 * The limits on the account settings routes. Each is a business rule, and tests and browser tests may change them.
 *
 * 1. `exports`: data exports per account in an hour (CC-035). An export reads every store of the account.
 * 2. `failedPasswords`: wrong passwords per account in 15 minutes, for export and deletion together, so a borrowed
 *    signed-in browser cannot be used to guess the password.
 */
export const ACCOUNT_LIMITS = Object.freeze({
  exports: Object.freeze({ windowMs: 60 * MINUTE_MS, limit: 3 }),
  failedPasswords: Object.freeze({ windowMs: 15 * MINUTE_MS, limit: 5 }),
});

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/** An object with exactly these fields, every one given. Content rules live in the domain. */
function requireExactly(body, fields) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Send a JSON object");
  }
  const unknown = Object.keys(body).filter((key) => !fields.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError("Unknown fields in payload", { details: { fields: unknown } });
  }
  return body;
}

const playerKey = (req) => `player:${requireIdentity(req.session).id}`;

/**
 * The signed-in player's own account (CC-035, CC-152). Guests get 403, visitors 401.
 *
 * 1. `GET /account` answers `{ account: { username, createdAt, birthYear?, ageGroup } }`.
 * 2. `PUT /account/birth-year` with `{ birthYear }` sets a year that is not set yet, and answers the account.
 * 3. `POST /account/export` with `{ password }` answers the player's data as a JSON file to download.
 * 4. `POST /account/delete` with `{ password }` deletes the account and everything linked to it, ends this
 *    session and every other one, and answers 204.
 *
 * @param {{
 *   accountComponent: Pick<ReturnType<typeof import("../../domain/accounts/accountComponent.js").createAccountComponent>, "profileOf" | "setBirthYear">,
 *   playerDataComponent: Pick<ReturnType<typeof import("../../domain/accounts/playerDataComponent.js").createPlayerDataComponent>, "deleteAccount" | "exportFor">,
 *   onSessionEnded: (sessionId: string) => void,
 *   onAccountDeleted: (playerId: string) => void,   told once an account is gone, so its sockets are disconnected
 *   now?: () => number,
 *   limits?: Partial<typeof ACCOUNT_LIMITS>,   any limit not given keeps its standard value
 * }} deps
 */
export function createAccountRoutes({
  accountComponent,
  playerDataComponent,
  onSessionEnded,
  onAccountDeleted,
  now = Date.now,
  limits = {},
}) {
  assertDefined(accountComponent, "accountComponent");
  assertDefined(playerDataComponent, "playerDataComponent");
  assertFunction(onSessionEnded, "onSessionEnded");
  assertFunction(onAccountDeleted, "onAccountDeleted");
  const rules = { ...ACCOUNT_LIMITS, ...limits };
  const router = Router();

  // Signed in first, so a visitor is told 401 and is never counted.
  const signedIn = (req, res, next) => {
    requireIdentity(req.session);
    next();
  };
  const exports = createRateLimit({ ...rules.exports, message: TOO_MANY, keyGenerator: playerKey });
  const failedPasswords = createRateLimit({
    ...rules.failedPasswords,
    message: TOO_MANY,
    keyGenerator: playerKey,
    skipSuccessfulRequests: true,
    headers: false,
  });

  router.get("/account", signedIn, async (req, res) => {
    const { id: playerId } = requireIdentity(req.session);
    res.json({ account: await accountComponent.profileOf({ playerId, now: now() }) });
  });

  router.put("/account/birth-year", signedIn, async (req, res) => {
    const { birthYear } = requireExactly(req.body, ["birthYear"]);
    const { id: playerId } = requireIdentity(req.session);
    const account = await accountComponent.setBirthYear({ playerId, birthYear, now: now() });
    req.log.info({ playerId }, "birth year set");
    res.json({ account });
  });

  router.post("/account/export", signedIn, failedPasswords, exports, async (req, res) => {
    const { password } = requireExactly(req.body, ["password"]);
    const { id: playerId } = requireIdentity(req.session);
    const at = now();
    const exported = await playerDataComponent.exportFor({ playerId, password, now: at });
    req.log.info({ playerId }, "data exported");
    res.set("Cache-Control", "no-store");
    res.attachment(`classicade-data-${dayOf(at)}.json`);
    res.json(exported);
  });

  router.post("/account/delete", signedIn, failedPasswords, async (req, res) => {
    const { password } = requireExactly(req.body, ["password"]);
    const { id: playerId } = requireIdentity(req.session);
    const { erased } = await playerDataComponent.deleteAccount({ playerId, password, now: now() });
    const sessionId = req.sessionID;
    await destroySession(req);
    res.clearCookie(SESSION_COOKIE_NAME);
    onSessionEnded(sessionId);
    onAccountDeleted(playerId);
    req.log.info({ playerId, erased }, "account deleted");
    res.status(204).end();
  });

  return router;
}
