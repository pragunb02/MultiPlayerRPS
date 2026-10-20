import { Router } from "express";
import { isChallengeId, isProfileHandle } from "@classicade/shared";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { clientIpKey, createRateLimit } from "./rateLimits.js";
import { requireIdentity } from "./session.js";

const MINUTE_MS = 60 * 1000;
const MAX_OPTION_KEYS = 8;

/**
 * The limits on challenges (CC-139, ADR-069), on top of the 3 open per sender and one in 10 minutes to the same
 * person that the challenge component checks. Each is a business rule, and tests and browser tests may change them.
 *
 * 1. `createsPerPlayer`: challenges made per player in 10 minutes.
 * 2. `createsPerAddress`: challenges made per network address in 10 minutes, five players' worth, so making new
 *    guests buys little and one player cannot use up a school's address.
 * 3. `answersPerPlayer`: takes, declines, withdrawals and moves to the inbox per player in 10 minutes.
 * 4. `lookupsPerPlayer` and `lookupsPerAddress`: challenges opened in a minute. Plenty for a page that reads its
 *    challenge again on every change, far too few to try ids: 100 random bits cannot be counted through.
 */
export const CHALLENGE_LIMITS_HTTP = Object.freeze({
  createsPerPlayer: Object.freeze({ windowMs: 10 * MINUTE_MS, limit: 10 }),
  createsPerAddress: Object.freeze({ windowMs: 10 * MINUTE_MS, limit: 50 }),
  answersPerPlayer: Object.freeze({ windowMs: 10 * MINUTE_MS, limit: 60 }),
  lookupsPerPlayer: Object.freeze({ windowMs: MINUTE_MS, limit: 60 }),
  lookupsPerAddress: Object.freeze({ windowMs: MINUTE_MS, limit: 300 }),
});

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * A new challenge: `{ gameId, options?, to? }` and nothing else. `to` is `{ handle }`, the profile handle of the one
 * person it is for (ADR-065), which only CC-052's friends may name. Options are checked by the game's engine.
 */
function parseCreate(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Send a JSON object");
  }
  const unknown = Object.keys(body).filter((key) => !["gameId", "options", "to"].includes(key));
  if (unknown.length > 0) {
    throw new ValidationError("Send a game, its options and who it is for", { details: { fields: unknown } });
  }
  if (typeof body.gameId !== "string") {
    throw new ValidationError("Say which game", { details: { field: "gameId" } });
  }
  const options = body.options ?? {};
  if (!isPlainObject(options) || Object.keys(options).length > MAX_OPTION_KEYS) {
    throw new ValidationError("Options must be an object", { details: { field: "options" } });
  }
  if (body.to === undefined) {
    return { gameId: body.gameId, options };
  }
  const { to } = body;
  if (!isPlainObject(to) || Object.keys(to).join() !== "handle" || !isProfileHandle(to.handle)) {
    throw new ValidationError("Name who it is for by their profile handle", { details: { field: "to" } });
  }
  return { gameId: body.gameId, options, to: Object.freeze({ handle: to.handle }) };
}

/** An answer carries no body, or an empty object. */
function requireEmpty(body) {
  if (body !== undefined && !(isPlainObject(body) && Object.keys(body).length === 0)) {
    throw new ValidationError("Send nothing with this request");
  }
}

/** A malformed id is an id nobody has: the same 404, so the answer never says what an id looks like. */
function challengeIdOf(req) {
  const { challengeId } = req.params;
  if (!isChallengeId(challengeId)) {
    throw new NotFoundError("No such challenge");
  }
  return challengeId;
}

/**
 * Challenges (CC-139, ADR-069). Every answer is `Cache-Control: no-store` and carries no player id: other players
 * are named by display name only.
 *
 * 1. `POST /challenges` with `{ gameId, options?, to? }` makes one and answers 201 `{ challenge }`. Guests and
 *    accounts, visitors get 401. A limit answers 409 with `details.reason`.
 * 2. `GET /challenges` answers `{ challenges }`, the player's inbox.
 * 3. `GET /challenges/:id` answers `{ challenge }` for anyone with the link, visitors too. An unknown, malformed or
 *    forgotten id is one 404.
 * 4. `POST /challenges/:id/accept` takes it and answers `{ challenge, room: { code, gameId } }`. One no longer open
 *    answers 410 with `details.state`, and a block reads as expired.
 * 5. `POST /challenges/:id/decline`, `/withdraw` and `/later` answer `{ challenge }`.
 *
 * @param {{
 *   challengeComponent: Pick<ReturnType<typeof import("../../domain/challenges/challengeComponent.js").createChallengeComponent>, "create" | "inbox" | "view" | "accept" | "decline" | "withdraw" | "later">,
 *   networkOf: (address: string) => import("../../utils/networkKey.js").NetworkNames,
 *   now?: () => number,
 *   limits?: Partial<typeof CHALLENGE_LIMITS_HTTP>,   any limit not given keeps its standard value
 * }} deps  `networkOf` names the taker's address for the room limits, as the realtime gateway does
 */
export function createChallengeRoutes({ challengeComponent, networkOf, now = Date.now, limits = {} }) {
  assertDefined(challengeComponent, "challengeComponent");
  assertFunction(networkOf, "networkOf");
  const rules = { ...CHALLENGE_LIMITS_HTTP, ...limits };
  const router = Router();
  const byPlayer = (req) => `player:${requireIdentity(req.session).id}`;

  const noStore = (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  };
  // Signed in first, so a visitor is told 401 and is never counted.
  const signedIn = (req, res, next) => {
    requireIdentity(req.session);
    next();
  };
  // The player's own limit comes first everywhere, so the network's budget counts only what it let through.
  const createsPerPlayer = createRateLimit({
    ...rules.createsPerPlayer,
    message: "Too many challenges made, try again later",
    keyGenerator: byPlayer,
  });
  const createsPerAddress = createRateLimit({
    ...rules.createsPerAddress,
    message: "Too many challenges made from your network, try again later",
    headers: false,
  });
  const answers = createRateLimit({
    ...rules.answersPerPlayer,
    message: "Too many answers to challenges, try again later",
    keyGenerator: byPlayer,
  });
  // A visitor has no player budget, so the address limit is theirs alone.
  const lookupsPerPlayer = createRateLimit({
    ...rules.lookupsPerPlayer,
    message: "Too many challenges opened, try again later",
    keyGenerator: byPlayer,
    skip: (req) => req.session.identity === undefined,
  });
  const lookupsPerAddress = createRateLimit({
    ...rules.lookupsPerAddress,
    message: "Too many challenges opened from your network, try again later",
    headers: false,
  });

  router.post("/challenges", noStore, signedIn, createsPerPlayer, createsPerAddress, async (req, res) => {
    const { gameId, options, to } = parseCreate(req.body);
    const from = requireIdentity(req.session);
    const challenge = await challengeComponent.create({
      from,
      gameId,
      options,
      ...(to && { to }),
      now: now(),
    });
    req.log.info({ playerId: from.id, gameId, toOne: to !== undefined }, "challenge made");
    res.status(201).json({ challenge });
  });

  router.get("/challenges", noStore, signedIn, lookupsPerPlayer, async (req, res) => {
    const { id: playerId } = requireIdentity(req.session);
    res.json({ challenges: await challengeComponent.inbox({ playerId, now: now() }) });
  });

  router.get("/challenges/:challengeId", noStore, lookupsPerPlayer, lookupsPerAddress, async (req, res) => {
    const challengeId = challengeIdOf(req);
    const viewerId = req.session.identity === undefined ? "" : requireIdentity(req.session).id;
    res.json({ challenge: await challengeComponent.view({ challengeId, viewerId, now: now() }) });
  });

  router.post("/challenges/:challengeId/accept", noStore, signedIn, answers, async (req, res) => {
    requireEmpty(req.body);
    const challengeId = challengeIdOf(req);
    const player = requireIdentity(req.session);
    const network = networkOf(clientIpKey(req));
    const taken = await challengeComponent.accept({
      challengeId,
      player,
      network: network.name,
      earlierNetworks: network.earlier,
      now: now(),
    });
    req.log.info({ playerId: player.id, roomCode: taken.room.code }, "challenge taken");
    res.json(taken);
  });

  for (const answer of ["decline", "withdraw", "later"]) {
    router.post(`/challenges/:challengeId/${answer}`, noStore, signedIn, answers, async (req, res) => {
      requireEmpty(req.body);
      const challengeId = challengeIdOf(req);
      const { id: playerId } = requireIdentity(req.session);
      const challenge = await challengeComponent[answer]({ challengeId, playerId, now: now() });
      req.log.info({ playerId, answer }, "challenge answered");
      res.json({ challenge });
    });
  }

  return router;
}
