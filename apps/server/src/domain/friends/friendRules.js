import { FRIEND_RULES } from "@classicade/shared";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * The friends rules as numbers (ADR-066.8). Each is a business rule, and tests may change them.
 *
 * 1. `maxFriends`: friends one player can have. It is checked against the player's own count when they send or
 *    accept, never against the other player's, which no answer may tell.
 * 2. `maxWaiting`: requests one player can have waiting for an answer, declined ones included, because the sender
 *    never knows which those are.
 * 3. `incomingShown`: waiting requests shown to their recipient, newest first.
 * 4. `requestLifetimeMs`: how long a request waits before it runs out.
 * 5. `linkLifetimeMs`: how long a friend link works. It works once.
 * 6. `linksKept`: friend links one player has at once. Making another drops the oldest.
 * 7. `ringAgainAfterMs`: a request cancelled and sent again tells its recipient again only after this long
 *    (ADR-031.1, one message per person every 15 minutes).
 */
export const FRIEND_LIMITS = Object.freeze({
  maxFriends: FRIEND_RULES.maxFriends,
  maxWaiting: FRIEND_RULES.maxWaiting,
  incomingShown: 50,
  requestLifetimeMs: FRIEND_RULES.requestDays * DAY_MS,
  linkLifetimeMs: FRIEND_RULES.linkDays * DAY_MS,
  linksKept: 5,
  ringAgainAfterMs: 15 * MINUTE_MS,
});

/** How two players met, for the minors' rule. */
export const MET_THROUGH = Object.freeze({
  /** A room joined by its link, or a match played there. Every room is one until quick match (CC-051) exists. */
  LINK_ROOM: "linkRoom",
  /** Quick match paired them with a stranger (CC-051). */
  QUICK_MATCH: "quickMatch",
  /** One opened the other's friend link. */
  FRIEND_LINK: "friendLink",
});

/**
 * Whether a request between two accounts may reach its recipient, given how they met (ADR-051.7, ADR-066.5).
 * Someone met through a link, a room's or a friend link, is someone a person shared a link with by hand: our "know
 * them in real life". A quick match stranger is not, so a pair with anyone not surely an adult may not become friends
 * that way. Such a request is still answered "Request sent", so the answer never tells anyone the other's age.
 *
 * @param {{ met: string, bothAdults: boolean }} pair  `met` is a MET_THROUGH value
 * @returns {boolean}
 */
export const mayReach = ({ met, bothAdults }) => met !== MET_THROUGH.QUICK_MATCH || bothAdults;
