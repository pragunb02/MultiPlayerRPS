import { FRIEND_RULES } from "@classicade/shared";
import { FRIENDS_MODES } from "../safety/agePolicy.js";

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
 * 8. `missedRingWithinMs`: a tab that connects is told again of a request that rang this recently and still waits,
 *    in case the ring came while it had no connection (CC-341). The same 15 minutes, so it is never told more often.
 */
export const FRIEND_LIMITS = Object.freeze({
  maxFriends: FRIEND_RULES.maxFriends,
  maxWaiting: FRIEND_RULES.maxWaiting,
  incomingShown: 50,
  requestLifetimeMs: FRIEND_RULES.requestDays * DAY_MS,
  linkLifetimeMs: FRIEND_RULES.linkDays * DAY_MS,
  linksKept: 5,
  ringAgainAfterMs: 15 * MINUTE_MS,
  missedRingWithinMs: 15 * MINUTE_MS,
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
 * Whether a request between two accounts may reach its recipient, given how they met and each one's friends mode
 * from the age policy (ADR-051.7, ADR-066.5, CC-152). Someone met through a link, a room's or a friend link, is
 * someone a person shared a link with by hand: our "know them in real life", which `mutual-known` allows. A quick
 * match stranger is not, so only a pair who may both befriend anyone (`mutual`) can become friends that way. Such a
 * request is still answered "Request sent", so the answer never tells anyone the other's age.
 *
 * @param {{ met: string, modes: ReadonlyArray<string> }} pair  `met` is a MET_THROUGH value, `modes` the
 *   FRIENDS_MODES of the two
 * @returns {boolean}
 */
export const mayReach = ({ met, modes }) =>
  met !== MET_THROUGH.QUICK_MATCH || modes.every((mode) => mode === FRIENDS_MODES.MUTUAL);
