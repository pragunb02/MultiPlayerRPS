import { NOT_COUNTED_REASONS } from "@classicade/shared";

/**
 * Fair play (CC-095): which recorded games count for a player's XP, wins, quests, achievements and leaderboard
 * places. Every rule lives in this file. The match pipeline judges each match once, right after it is recorded,
 * and stores the verdict on the match, so every later step and every recount gives the same answer.
 *
 * A game that doesn't count still stays in match history.
 */
export const FAIR_PLAY_LIMITS = Object.freeze({
  /** moves every player must have made for a game someone left to count */
  MIN_MOVES_EACH: 2,
  /** counted games between the same two players in one UTC day */
  GAMES_PER_OPPONENT_PER_DAY: 10,
  /** counted games of one player in one UTC clock hour */
  GAMES_PER_HOUR: 20,
});

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// The outcome reason the room component gives a game somebody left.
const LEFT_THE_GAME = "forfeit";

/**
 * @typedef {Readonly<{ counted: true } | { counted: false, reason: string }>} Verdict   how a match counts for one
 *   player. `reason` is a NOT_COUNTED_REASONS value
 * @typedef {import("../../data/matchAccessor.js").CountedGame} CountedGame   another game of the player that counts
 *   for them, or that nobody judged yet
 */

const COUNTED = Object.freeze({ counted: true });
const notCounted = (reason) => Object.freeze({ counted: false, reason });
const hourOf = (at) => Math.floor(at / HOUR_MS);

/**
 * The UTC day a moment falls in.
 *
 * @param {number} at  ms since the epoch
 * @returns {Readonly<{ from: number, to: number }>} the day's first ms, and the next day's first ms
 */
export function utcDayOf(at) {
  const from = at - (at % DAY_MS);
  return Object.freeze({ from, to: from + DAY_MS });
}

/**
 * A game ended too soon when a player never moved, or when someone left before every player made
 * `MIN_MOVES_EACH` moves. Moves, not seconds: waiting is free for a script, and a quick honest game should count.
 * A game played to its end by the rules counts once everyone moved, so a one round Rock Paper Scissors match
 * still counts. The daily and hourly limits stop that from being repeated for XP.
 *
 * @param {Readonly<import("../../data/matchAccessor.js").Match>} match
 */
export function endedTooSoon(match) {
  const moves = match.players.map(
    ({ playerId }) =>
      match.log.filter((entry) => entry.kind === "move" && entry.playerId === playerId).length,
  );
  const someoneNeverMoved = moves.some((count) => count === 0);
  const leftEarly =
    match.result.reason === LEFT_THE_GAME && moves.some((count) => count < FAIR_PLAY_LIMITS.MIN_MOVES_EACH);
  return someoneNeverMoved || leftEarly;
}

/**
 * Whether a recorded match counts for one of its players. The limits look at the player's other games of the same
 * UTC day that count, before and after this one, so games judged at the same moment, or a guest's games added to
 * an account later, can never add up to more than the limits allow.
 *
 * @param {{
 *   match: Readonly<import("../../data/matchAccessor.js").Match>,
 *   playerId: string,
 *   others: ReadonlyArray<CountedGame>,
 * }} input  `others` may hold games of other days and this match itself. Both are ignored
 * @returns {Verdict}
 */
export function judgeMatch({ match, playerId, others }) {
  if (endedTooSoon(match)) {
    return notCounted(NOT_COUNTED_REASONS.ENDED_TOO_SOON);
  }
  const { from, to } = utcDayOf(match.endedAt);
  const sameDay = others.filter(
    (other) => other.matchId !== match.matchId && other.endedAt >= from && other.endedAt < to,
  );
  const opponents = match.players.map((p) => p.playerId).filter((id) => id !== playerId);
  const gamesAgainst = (opponent) =>
    sameDay.filter((other) => other.players.some((p) => p.playerId === opponent)).length;
  if (opponents.some((opponent) => gamesAgainst(opponent) >= FAIR_PLAY_LIMITS.GAMES_PER_OPPONENT_PER_DAY)) {
    return notCounted(NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT);
  }
  const sameHour = sameDay.filter((other) => hourOf(other.endedAt) === hourOf(match.endedAt));
  if (sameHour.length >= FAIR_PLAY_LIMITS.GAMES_PER_HOUR) {
    return notCounted(NOT_COUNTED_REASONS.HOURLY_LIMIT);
  }
  return COUNTED;
}

/**
 * How a match counts for one player, as judged when it was recorded. A match recorded before CC-095 was never
 * judged and counts, as it always did.
 *
 * @param {Readonly<import("../../data/matchAccessor.js").Match>} match
 * @param {string} playerId
 * @returns {Verdict}
 */
export function creditFor(match, playerId) {
  const entry = match.credit?.notCounted.find((e) => e.playerId === playerId);
  return entry === undefined ? COUNTED : notCounted(entry.reason);
}
