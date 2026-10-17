import { BOT_DAILY_XP, NOT_COUNTED_REASONS } from "@classicade/shared";

const MESSAGES = Object.freeze({
  [NOT_COUNTED_REASONS.ENDED_TOO_SOON]: "This game didn't count: it ended too soon",
  [NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT]:
    "This game didn't count: daily limit with this opponent reached",
  [NOT_COUNTED_REASONS.HOURLY_LIMIT]:
    "This game didn't count: you reached the limit of counted games this hour",
});

/**
 * What a player reads when a game gave them no XP, wins or quest progress (CC-095).
 *
 * @param {string} reason  a NOT_COUNTED_REASONS value
 * @returns {string}
 */
export function notCountedMessage(reason) {
  // A reason added on the server before this app learned it still gets an honest, if shorter, message.
  return MESSAGES[reason] ?? "This game didn't count";
}

/**
 * Whether a `progress:updated` push is a match that didn't count for this player.
 *
 * @param {{ source: string, counted?: boolean }} update
 */
export const isUncountedMatch = ({ source, counted }) => source === "match" && counted === false;

/**
 * Whether a `progress:updated` push is a counted game against a computer character, which says how much of the
 * day's XP from such games is left (ADR-025).
 *
 * @param {{ source: string, counted?: boolean, botXpLeft?: number }} update
 */
export const isComputerGame = ({ source, counted, botXpLeft }) =>
  source === "match" && counted === true && botXpLeft !== undefined;

/**
 * What a player reads after a counted game against a computer character: the XP and what is left for today, or
 * that the game still counts once today's XP from computer games is used up.
 *
 * @param {{ xpGained: number, botXpLeft: number }} update
 * @returns {string}
 */
export function computerXpMessage({ xpGained, botXpLeft }) {
  return xpGained > 0
    ? `+${xpGained} XP · ${botXpLeft} XP left today from computer games`
    : `This game counts for your quests. You already have today's ${BOT_DAILY_XP} XP from computer games`;
}
