import { Router } from "express";
import { isFriendLinkToken, isProfileHandle } from "@classicade/shared";
import { assertDefined } from "../../utils/assert.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { parsePlayedWith, UUID_PATTERN } from "./playedWith.js";
import { createRateLimit } from "./rateLimits.js";
import { requireIdentity } from "./session.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * The limits on friends (CC-052, ADR-066.8). Each is a business rule, and tests and browser tests may change them.
 * The address limits are five players' worth, and count only what the player's own limit let through, so one player
 * cannot use up a school's or a carrier's address (ADR-053.5).
 *
 * 1. `sendsPerPlayer`, `sendsPerAddress`: requests sent and friend links used, in an hour. Plenty for someone who
 *    just played a few games, and far too few to work through a room's seats.
 * 2. `changesPerPlayer`, `changesPerAddress`: answers, cancels, removals, the switch and new links, in 10 minutes.
 * 3. `lookupsPerPlayer`, `lookupsPerAddress`: friend link pages opened, in a minute. A token has 128 random bits, so
 *    no number of tries finds one.
 */
export const FRIEND_ROUTE_LIMITS = Object.freeze({
  sendsPerPlayer: Object.freeze({ windowMs: HOUR_MS, limit: 20 }),
  sendsPerAddress: Object.freeze({ windowMs: HOUR_MS, limit: 100 }),
  changesPerPlayer: Object.freeze({ windowMs: 10 * MINUTE_MS, limit: 60 }),
  changesPerAddress: Object.freeze({ windowMs: 10 * MINUTE_MS, limit: 300 }),
  lookupsPerPlayer: Object.freeze({ windowMs: MINUTE_MS, limit: 30 }),
  lookupsPerAddress: Object.freeze({ windowMs: MINUTE_MS, limit: 150 }),
});

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/** The one field a change sends, and nothing else. */
function onlyField(body, field) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Send a JSON object");
  }
  const unknown = Object.keys(body).filter((key) => key !== field);
  if (unknown.length > 0) {
    throw new ValidationError(`Send only ${field}`, { details: { fields: unknown } });
  }
  return body[field];
}

/** A request id of the right shape. Any other shape is a request nobody has: the same 404. */
function requestIdOf(req) {
  const { requestId } = req.params;
  if (!UUID_PATTERN.test(requestId)) throw new NotFoundError("This request is no longer open");
  return requestId;
}

/** A token of the right shape. Any other shape is a link nobody made: the same 404. */
function tokenOf(req) {
  const { token } = req.params;
  if (!isFriendLinkToken(token)) throw new NotFoundError("This friend link has run out or was used already");
  return token;
}

/**
 * Friends (CC-052, ADR-066), for accounts only. Visitors get 401 and guests 403 "Save your progress to add friends",
 * except the friend link's page, which anyone holding the link may open. Every answer is
 * `Cache-Control: no-store`: what it shows depends on who asks and changes at any time.
 *
 * 1. `GET /friends` answers the player's view: `{ friends: [{ handle, displayName, avatar?, presence, since,
 *    profile? }], incoming: [{ requestId, displayName, avatar?, via, sentAt }], outgoing: [{ requestId,
 *    displayName, avatar?, sentAt }], settings: { appearOffline }, safetyTips }`.
 * 2. `POST /friends/requests` with `{ roomCode, seat, seatId }` or `{ matchId, seat }`, someone the player played
 *    with, answers `{ result: "sent" | "friends" }`. "sent" also for a block or a decline, which it never shows.
 * 3. `POST /friends/requests/:requestId/answer` with `{ answer: "accept" | "decline" }` answers `{ result }`.
 * 4. `DELETE /friends/requests/:requestId` cancels one of the player's own requests, 204.
 * 5. `DELETE /friends/:handle` removes a friend, 204. Anyone who is not a friend gets 404.
 * 6. `PUT /friends/settings` with `{ appearOffline }` answers `{ settings }`.
 * 7. `POST /friends/links` answers `{ link: { token, expiresAt } }`, a new one-use friend link.
 * 8. `GET /friends/links/:token` answers `{ invite: { displayName, avatar?, own? } }`, for visitors too. A link that
 *    ran out, was used or never existed gets one 404. Reading it never uses it up.
 * 9. `POST /friends/links/:token` uses the link: its maker gets a request. Answers `{ result }`.
 *
 * @param {{
 *   friendComponent: Pick<ReturnType<typeof import("../../domain/friends/friendComponent.js").createFriendComponent>, "viewFor" | "sendRequest" | "answerRequest" | "cancelRequest" | "removeFriend" | "setAppearOffline" | "makeLink" | "linkInvite" | "useLink">,
 *   now?: () => number,
 *   limits?: Partial<typeof FRIEND_ROUTE_LIMITS>,   any limit not given keeps its standard value
 * }} deps
 */
export function createFriendRoutes({ friendComponent, now = Date.now, limits = {} }) {
  assertDefined(friendComponent, "friendComponent");
  const rules = { ...FRIEND_ROUTE_LIMITS, ...limits };
  const router = Router();

  const noStore = (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  };
  // Signed in first, so a visitor is told 401 and is never counted.
  const signedIn = (req, res, next) => {
    requireIdentity(req.session);
    next();
  };
  const playerKey = (req) => `player:${requireIdentity(req.session).id}`;
  /** A budget per player, then one per address that counts only what the player's own budget let through. */
  const budget = (name, words) => [
    createRateLimit({
      ...rules[`${name}PerPlayer`],
      message: `Too many ${words}, try again later`,
      keyGenerator: playerKey,
    }),
    createRateLimit({
      ...rules[`${name}PerAddress`],
      message: `Too many ${words} from your network, try again later`,
      headers: false,
    }),
  ];
  const sends = budget("sends", "friend requests");
  const changes = budget("changes", "changes to your friends");
  // A visitor has no player budget, so the address limit is theirs alone.
  const lookups = [
    createRateLimit({
      ...rules.lookupsPerPlayer,
      message: "Too many friend links opened, try again later",
      keyGenerator: playerKey,
      skip: (req) => req.session.identity === undefined,
    }),
    createRateLimit({
      ...rules.lookupsPerAddress,
      message: "Too many friend links opened from your network, try again later",
      headers: false,
    }),
  ];
  const playerIdOf = (req) => requireIdentity(req.session).id;

  router.get("/friends", noStore, signedIn, async (req, res) => {
    res.json(await friendComponent.viewFor({ playerId: playerIdOf(req), now: now() }));
  });

  router.post("/friends/requests", noStore, signedIn, ...sends, async (req, res) => {
    const target = parsePlayedWith(req.body);
    const playerId = playerIdOf(req);
    const { result } = await friendComponent.sendRequest({ playerId, target, now: now() });
    // Who was asked is never logged, and nor is the answer, which could tell a block from a request.
    req.log.info({ playerId }, "friend request sent");
    res.json({ result });
  });

  router.post("/friends/requests/:requestId/answer", noStore, signedIn, ...changes, async (req, res) => {
    const requestId = requestIdOf(req);
    const answer = onlyField(req.body, "answer");
    const playerId = playerIdOf(req);
    const { result } = await friendComponent.answerRequest({ playerId, requestId, answer, now: now() });
    req.log.info({ playerId }, "friend request answered");
    res.json({ result });
  });

  router.delete("/friends/requests/:requestId", noStore, signedIn, ...changes, async (req, res) => {
    const requestId = requestIdOf(req);
    await friendComponent.cancelRequest({ playerId: playerIdOf(req), requestId, now: now() });
    res.status(204).end();
  });

  router.put("/friends/settings", noStore, signedIn, ...changes, async (req, res) => {
    const appearOffline = onlyField(req.body, "appearOffline");
    const settings = await friendComponent.setAppearOffline({
      playerId: playerIdOf(req),
      appearOffline,
      now: now(),
    });
    res.json({ settings });
  });

  router.post("/friends/links", noStore, signedIn, ...changes, async (req, res) => {
    const playerId = playerIdOf(req);
    const link = await friendComponent.makeLink({ playerId, now: now() });
    req.log.info({ playerId }, "friend link made");
    res.json({ link });
  });

  router.get("/friends/links/:token", noStore, ...lookups, async (req, res) => {
    const token = tokenOf(req);
    const viewerId = req.session.identity === undefined ? "" : playerIdOf(req);
    res.json({ invite: await friendComponent.linkInvite({ token, viewerId, now: now() }) });
  });

  router.post("/friends/links/:token", noStore, signedIn, ...sends, async (req, res) => {
    const token = tokenOf(req);
    const playerId = playerIdOf(req);
    const { result } = await friendComponent.useLink({ playerId, token, now: now() });
    req.log.info({ playerId }, "friend link used");
    res.json({ result });
  });

  // After the routes above, so "requests", "settings" and "links" are never read as a handle.
  router.delete("/friends/:handle", noStore, signedIn, ...changes, async (req, res) => {
    const { handle } = req.params;
    if (!isProfileHandle(handle)) throw new NotFoundError("No such friend");
    await friendComponent.removeFriend({ playerId: playerIdOf(req), handle });
    res.status(204).end();
  });

  return router;
}
