import { NOT_COUNTED_REASONS } from "@classicade/shared";

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
