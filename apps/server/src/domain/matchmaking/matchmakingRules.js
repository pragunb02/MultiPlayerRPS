import { GAME_IDS, QUICK_MATCH_RULES } from "@classicade/shared";
import { FAIR_PLAY_LIMITS } from "../matches/fairPlay.js";
import { isRatedGame } from "../ratings/chessRatingRules.js";

/**
 * The quick match rules (CC-051, ADR-079) as pure functions and numbers. Each number is a business rule: changing
 * one is a one-line change with a test (ADR-029.5). The research behind each is in docs/tickets/CC-051.md.
 *
 * 1. `searchMs`: the longest a search looks for a person (ADR-029: at most 4 s).
 * 2. `minOthersOnline`: a search runs only when at least this many other players are connected, or someone is
 *    already searching a game this player could be paired with. Below it the site is empty and Play starts the
 *    computer character at once, with no wait (ADR-029, the liquidity gate).
 * 3. `waitSamples`, `minWaitSamples`, `timeoutPercentile`, `minSearchMs`: once `minWaitSamples` searches found a
 *    person, a search lasts as long as the 80th percentile of the last `waitSamples` waits that found one, never
 *    more than `searchMs` and never less than `minSearchMs` (ADR-029's "Search timeout" row).
 * 4. `bandWidth`, `windowStartRating`, `windowGrowthPerSecond`, `windowMaxRating`: chess pairs within a rating
 *    window that starts at 100 points and widens by 50 each second the older of the two has waited, up to 300
 *    (Lichess's limit is about 100 to 133 at the start, widening each missed wave). Pools are bands of 300 points,
 *    so a seeker looks in its own band and the two beside it.
 * 5. `pairsPerDay`: quick match pairs the same two people at most this many times in any 24 hours, the fair play
 *    cap on counted games per pair (ADR-021.3), so a pair cannot farm each other through the queue.
 * 6. `sweepMs`: how often waiting chess searches are looked at again, as their windows widen.
 */
export const MATCHMAKING_RULES = Object.freeze({
  searchMs: QUICK_MATCH_RULES.searchMs,
  minOthersOnline: 1,
  waitSamples: 100,
  minWaitSamples: 20,
  timeoutPercentile: 0.8,
  minSearchMs: 1_000,
  bandWidth: 300,
  windowStartRating: 100,
  windowGrowthPerSecond: 50,
  windowMaxRating: 300,
  pairsPerDay: FAIR_PLAY_LIMITS.GAMES_PER_OPPONENT_PER_DAY,
  sweepMs: 250,
});

/** Why a search ended without looking, for the counts. */
export const SKIP_REASONS = Object.freeze({
  /** Nobody else is connected and nobody is searching: the site is empty. */
  EMPTY: "empty",
  /** The player's age policy keeps them out of every search (CC-152). */
  POLICY: "policy",
});

/**
 * The options of a quick match game: chess has one pool at 3+2 (ADR-051.6), every other game its defaults.
 *
 * @param {string} gameId
 * @returns {Readonly<Record<string, unknown>>}
 */
export const quickMatchOptions = (gameId) =>
  Object.freeze(gameId === GAME_IDS.CHESS ? { timeControl: QUICK_MATCH_RULES.chessTimeControl } : {});

/**
 * The pool a search waits in: one per game, and for a rated game one per rating band.
 *
 * @param {{ gameId: string, rating?: number }} search
 * @param {Readonly<typeof MATCHMAKING_RULES>} [rules]
 */
export function poolKeyOf({ gameId, rating }, rules = MATCHMAKING_RULES) {
  if (!isRatedGame(gameId) || rating === undefined) return gameId;
  return `${gameId}:${Math.floor(rating / rules.bandWidth)}`;
}

/**
 * The pools a search may find a partner in: its own and, for a rated game, the bands on either side.
 *
 * @param {{ gameId: string, rating?: number }} search
 * @param {Readonly<typeof MATCHMAKING_RULES>} [rules]
 * @returns {ReadonlyArray<string>}
 */
export function nearbyPoolKeys({ gameId, rating }, rules = MATCHMAKING_RULES) {
  if (!isRatedGame(gameId) || rating === undefined) return [gameId];
  const band = Math.floor(rating / rules.bandWidth);
  return [band - 1, band, band + 1].map((each) => `${gameId}:${each}`);
}

/**
 * The widest rating gap a pair may have after the older search waited `waitMs`.
 *
 * @param {number} waitMs
 * @param {Readonly<typeof MATCHMAKING_RULES>} [rules]
 */
export const ratingWindow = (waitMs, rules = MATCHMAKING_RULES) =>
  Math.min(
    rules.windowMaxRating,
    rules.windowStartRating + (rules.windowGrowthPerSecond * Math.max(0, waitMs)) / 1_000,
  );

/**
 * @typedef {Object} Seeker   what the rules need of one search
 * @property {string} playerId
 * @property {string} gameId
 * @property {number} since          when it started looking, ms since the epoch
 * @property {number} order          a number that only grows, for searches that started in the same ms
 * @property {number} [rating]       the chess rating, for a rated game
 * @property {ReadonlySet<string>} blocked   everyone on either side of a block with the player (ADR-053)
 * @property {ReadonlySet<string>} avoid     players a pairing with already failed during this search
 */

/**
 * Whether two searches may be paired now. Never the same person, never a blocked pair either way, never a pair
 * that failed already in this search, never a pair at its daily cap, and for a rated game only within the window.
 *
 * @param {{ a: Seeker, b: Seeker, now: number, pairCount: number }} pair  `pairCount` is how often quick match paired
 *   these two in the last 24 hours
 * @param {Readonly<typeof MATCHMAKING_RULES>} [rules]
 */
export function mayPair({ a, b, now, pairCount }, rules = MATCHMAKING_RULES) {
  if (a.playerId === b.playerId || a.gameId !== b.gameId) return false;
  if (a.blocked.has(b.playerId) || b.blocked.has(a.playerId)) return false;
  if (a.avoid.has(b.playerId) || b.avoid.has(a.playerId)) return false;
  if (pairCount >= rules.pairsPerDay) return false;
  if (!isRatedGame(a.gameId)) return true;
  const waited = now - Math.min(a.since, b.since);
  return Math.abs((a.rating ?? 0) - (b.rating ?? 0)) <= ratingWindow(waited, rules);
}

/**
 * The fair pairing order: the search that has waited longest and may be paired with the seeker, first come, first
 * served. Lichess weighs its whole wave at once, which needs a crowd. Our pools hold a few people, and first come
 * first served is the order a player can understand.
 *
 * @param {{ seeker: Seeker, candidates: Iterable<Seeker>, now: number, pairCountOf: (a: Seeker, b: Seeker) => number }} query
 * @param {Readonly<typeof MATCHMAKING_RULES>} [rules]
 * @returns {Seeker | undefined}
 */
export function pickPartner({ seeker, candidates, now, pairCountOf }, rules = MATCHMAKING_RULES) {
  return [...candidates]
    .filter((other) => other !== seeker)
    .sort((x, y) => x.since - y.since || x.order - y.order)
    .find((other) => mayPair({ a: seeker, b: other, now, pairCount: pairCountOf(seeker, other) }, rules));
}

/**
 * How long a search looks: `searchMs` until enough searches found a person, then the 80th percentile of the waits
 * that did, between `minSearchMs` and `searchMs` (ADR-029).
 *
 * @param {ReadonlyArray<number>} recentWaits  the waits of the latest searches that found a person, in ms
 * @param {Readonly<typeof MATCHMAKING_RULES>} [rules]
 */
export function searchTimeoutMs(recentWaits, rules = MATCHMAKING_RULES) {
  if (recentWaits.length < rules.minWaitSamples) return rules.searchMs;
  const sorted = [...recentWaits].sort((x, y) => x - y);
  const index = Math.min(sorted.length - 1, Math.ceil(rules.timeoutPercentile * sorted.length) - 1);
  return Math.min(rules.searchMs, Math.max(rules.minSearchMs, sorted[index]));
}

/**
 * Whether a search looks for a person at all, and for how long: the liquidity gate (ADR-029). It looks when someone
 * it could be paired with is searching already, or when at least `minOthersOnline` other players are connected.
 *
 * @param {{ othersOnline: number, partnerWaiting: boolean, recentWaits: ReadonlyArray<number> }} site
 * @param {Readonly<typeof MATCHMAKING_RULES>} [rules]
 * @returns {Readonly<{ search: true, timeoutMs: number } | { search: false, reason: string }>}
 */
export function searchPlan({ othersOnline, partnerWaiting, recentWaits }, rules = MATCHMAKING_RULES) {
  if (!partnerWaiting && othersOnline < rules.minOthersOnline) {
    return Object.freeze({ search: false, reason: SKIP_REASONS.EMPTY });
  }
  return Object.freeze({ search: true, timeoutMs: searchTimeoutMs(recentWaits, rules) });
}
