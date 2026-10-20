import { Router } from "express";
import { isProfileHandle } from "@classicade/shared";
import { assertDefined } from "../../utils/assert.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { createRateLimit } from "./rateLimits.js";
import { requireIdentity } from "./session.js";

const MINUTE_MS = 60 * 1000;

/**
 * The limits on profiles (CC-034, ADR-065). Each is a business rule, and tests and browser tests may change them.
 *
 * 1. `lookupsPerAddress`: profiles opened per network address in a minute, five times one player's budget, so one
 *    player cannot use up a school's or a carrier's address. Plenty for everyone behind it, and far
 *    too few to try handles: 80 random bits would take longer than the universe has existed.
 * 2. `lookupsPerPlayer`: profiles opened per signed-in player in a minute. Plenty for someone reading a board.
 * 3. `changesPerPlayer`: avatar and visibility changes per player in 10 minutes.
 */
export const PROFILE_LIMITS = Object.freeze({
  lookupsPerAddress: Object.freeze({ windowMs: MINUTE_MS, limit: 150 }),
  lookupsPerPlayer: Object.freeze({ windowMs: MINUTE_MS, limit: 30 }),
  changesPerPlayer: Object.freeze({ windowMs: 10 * MINUTE_MS, limit: 30 }),
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

/**
 * Profiles and avatars (CC-034, ADR-065).
 *
 * 1. `GET /profile` answers `{ profile: { handle, avatar?, visibility, canBePublic } }`, the player's own, for
 *    guests and accounts alike. Visitors get 401.
 * 2. `PUT /profile/avatar` with `{ avatar }` sets the avatar, and answers the same.
 * 3. `PUT /profile/visibility` with `{ visibility: "public" | "private" }` sets who can see it. Only an adult account
 *    may choose public (403 for anyone else).
 * 4. `GET /profiles/:handle` answers `{ player }`, what the viewer may see of that profile, for visitors too. A
 *    handle nobody has, a malformed one and a deleted player's get the same 404. A blocked pair gets what a visitor
 *    gets, so a block never shows (ADR-053).
 *
 * Every answer is `Cache-Control: no-store`: what a profile shows depends on who asks and can change at any time.
 *
 * @param {{
 *   profileComponent: Pick<ReturnType<typeof import("../../domain/profiles/profileComponent.js").createProfileComponent>, "ownProfile" | "setAvatar" | "setVisibility" | "publicView">,
 *   now?: () => number,
 *   limits?: Partial<typeof PROFILE_LIMITS>,   any limit not given keeps its standard value
 * }} deps
 */
export function createProfileRoutes({ profileComponent, now = Date.now, limits = {} }) {
  assertDefined(profileComponent, "profileComponent");
  const rules = { ...PROFILE_LIMITS, ...limits };
  const router = Router();

  // Signed in first, so a visitor is told 401 and is never counted.
  const signedIn = (req, res, next) => {
    requireIdentity(req.session);
    next();
  };
  const noStore = (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  };
  const changes = createRateLimit({
    ...rules.changesPerPlayer,
    message: "Too many changes to your profile, try again later",
    keyGenerator: (req) => `player:${requireIdentity(req.session).id}`,
  });
  // A visitor has no player budget, so the address limit is theirs alone.
  const lookupsPerPlayer = createRateLimit({
    ...rules.lookupsPerPlayer,
    message: "Too many profiles opened, try again later",
    keyGenerator: (req) => `player:${requireIdentity(req.session).id}`,
    skip: (req) => req.session.identity === undefined,
  });
  const lookupsPerAddress = createRateLimit({
    ...rules.lookupsPerAddress,
    message: "Too many profiles opened from your network, try again later",
    headers: false,
  });

  router.get("/profile", noStore, signedIn, async (req, res) => {
    const player = requireIdentity(req.session);
    res.json({ profile: await profileComponent.ownProfile({ player, now: now() }) });
  });

  router.put("/profile/avatar", noStore, signedIn, changes, async (req, res) => {
    const avatar = onlyField(req.body, "avatar");
    const player = requireIdentity(req.session);
    res.json({ profile: await profileComponent.setAvatar({ player, avatar, now: now() }) });
  });

  router.put("/profile/visibility", noStore, signedIn, changes, async (req, res) => {
    const visibility = onlyField(req.body, "visibility");
    const player = requireIdentity(req.session);
    const profile = await profileComponent.setVisibility({ player, visibility, now: now() });
    req.log.info({ playerId: player.id, visibility: profile.visibility }, "profile visibility changed");
    res.json({ profile });
  });

  // The player's own limit first, so the network's budget counts only what it let through.
  router.get("/profiles/:handle", noStore, lookupsPerPlayer, lookupsPerAddress, async (req, res) => {
    const { handle } = req.params;
    // A malformed handle is a handle nobody has: the same 404, so the answer never says what a handle looks like.
    if (!isProfileHandle(handle)) {
      throw new NotFoundError("No such player");
    }
    const viewerId = req.session.identity === undefined ? "" : requireIdentity(req.session).id;
    res.json({ player: await profileComponent.publicView({ handle, viewerId, now: now() }) });
  });

  return router;
}
