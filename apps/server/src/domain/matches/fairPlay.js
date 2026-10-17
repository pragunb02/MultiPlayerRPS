import { BOT_DAILY_XP, NOT_COUNTED_REASONS, XP_AWARDS } from "@classicade/shared";
import { isBotPlayerId, opponentKey } from "../../models/botIdentity.js";

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
  /**
   * counted games between the same two players in any 24 hours (ADR-021 amendment). Each computer character counts
   * as one opponent at every level (ADR-025)
   */
  GAMES_PER_OPPONENT_PER_DAY: 10,
  /** counted games of one player in one UTC clock hour, games against computer characters included */
  GAMES_PER_HOUR: 20,
  /** XP a player earns from games against computer characters in one UTC day (ADR-025) */
  BOT_XP_PER_DAY: BOT_DAILY_XP,
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
 * @typedef {Readonly<{ xp: number, left: number }>} BotXp   what a game against a computer character gives a player:
 *   its XP after the daily limit, and how much of the day's limit is left after it
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
 * The other games the limits look at for a game that ended at `at`: those that ended within a day before or after
 * it. That holds the UTC day, the clock hour and the rolling 24 hours of the opponent limit.
 *
 * @param {number} at  ms since the epoch
 * @returns {Readonly<{ from: number, to: number }>}
 */
export function limitWindowOf(at) {
  return Object.freeze({ from: at - DAY_MS, to: at + DAY_MS });
}

/** Whether a computer character played in the match. */
export const hasComputerPlayer = (match) => match.players.some(({ playerId }) => isBotPlayerId(playerId));

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
 * Whether a recorded match counts for one of its players. The limits look at the player's other games that count,
 * before and after this one, so games judged at the same moment, or a guest's games added to an account later,
 * can never add up to more than the limits allow. Against one opponent that is at most ten counted games in any
 * 24 hours: a game counts only when fewer than ten others against the same opponent ended within 24 hours of it,
 * either side.
 *
 * @param {{
 *   match: Readonly<import("../../data/matchAccessor.js").Match>,
 *   playerId: string,
 *   others: ReadonlyArray<CountedGame>,
 * }} input  `others` may hold games outside the window and this match itself. Both are ignored
 * @returns {Verdict}
 */
export function judgeMatch({ match, playerId, others }) {
  if (endedTooSoon(match)) {
    return notCounted(NOT_COUNTED_REASONS.ENDED_TOO_SOON);
  }
  const near = others.filter(
    (other) => other.matchId !== match.matchId && Math.abs(other.endedAt - match.endedAt) < DAY_MS,
  );
  const opponents = match.players.map((p) => opponentKey(p.playerId)).filter((id) => id !== playerId);
  const gamesAgainst = (opponent) =>
    near.filter((other) => other.players.some((p) => opponentKey(p.playerId) === opponent)).length;
  if (opponents.some((opponent) => gamesAgainst(opponent) >= FAIR_PLAY_LIMITS.GAMES_PER_OPPONENT_PER_DAY)) {
    return notCounted(NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT);
  }
  const sameHour = near.filter((other) => hourOf(other.endedAt) === hourOf(match.endedAt));
  if (sameHour.length >= FAIR_PLAY_LIMITS.GAMES_PER_HOUR) {
    return notCounted(NOT_COUNTED_REASONS.HOURLY_LIMIT);
  }
  return COUNTED;
}

/**
 * The XP a counted game against a computer character gives one player, within `BOT_XP_PER_DAY` for the UTC day
 * (ADR-025). The limit looks at the player's other such games of the day, before and after this one. One that is
 * not judged yet is taken at the most a game can give, so two games judged at the same moment can only give too
 * little, never too much.
 *
 * @param {{
 *   match: Readonly<import("../../data/matchAccessor.js").Match>,
 *   playerId: string,
 *   others: ReadonlyArray<CountedGame>,
 *   award: number,
 * }} input  `award` is the XP the game would give without the limit
 * @returns {BotXp}
 */
export function botXpFor({ match, playerId, others, award }) {
  const { from, to } = utcDayOf(match.endedAt);
  const used = others
    .filter(
      (other) =>
        other.matchId !== match.matchId &&
        other.endedAt >= from &&
        other.endedAt < to &&
        hasComputerPlayer(other),
    )
    .reduce((sum, other) => sum + botXpEarned(other, playerId), 0);
  const room = Math.max(0, FAIR_PLAY_LIMITS.BOT_XP_PER_DAY - used);
  const xp = Math.min(award, room);
  return Object.freeze({ xp, left: room - xp });
}

/** What another game against a computer gave the player: as judged, or the most possible until it is judged. */
function botXpEarned(other, playerId) {
  if (other.credit === undefined) {
    return XP_AWARDS.win;
  }
  return other.credit.botXp?.find((entry) => entry.playerId === playerId)?.xp ?? 0;
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

/**
 * The XP a counted match gives a player: the award for their result, or less when a game against a computer
 * character went past the day's limit (ADR-025).
 *
 * @param {Readonly<import("../../data/matchAccessor.js").Match>} match
 * @param {string} playerId
 * @param {number} award  the XP for the player's result
 */
export function xpFor(match, playerId, award) {
  return match.credit?.botXp?.find((entry) => entry.playerId === playerId)?.xp ?? award;
}

/**
 * The XP a guest's game against a computer character no longer gives, now that it is the account's: the part past
 * what the account's own games of that day had left of the daily limit (ADR-025). Only for a game that
 * `listWithdrawn` found with such a part.
 *
 * @param {Readonly<import("../../data/matchAccessor.js").Match>} match
 * @param {string} playerId  the account
 * @returns {number}
 */
export function botXpWithdrawnFrom(match, playerId) {
  return match.credit.botXp.find((entry) => entry.playerId === playerId).withdrawnXp;
}

/**
 * How much of the day's limit for games against computer characters was left after this match, for a player who
 * played one. Only matches against a computer character that were judged have it.
 *
 * @param {Readonly<import("../../data/matchAccessor.js").Match>} match
 * @param {string} playerId
 * @returns {ReadonlyArray<number>} one number, or none
 */
export function botXpLeftAfter(match, playerId) {
  const entry = match.credit?.botXp?.find((e) => e.playerId === playerId);
  return entry === undefined ? [] : [entry.left];
}
