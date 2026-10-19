import { ROOM_STATUS } from "@classicade/shared";
import { SOUNDS } from "../../lib/sound/sounds.js";
import { outcomeLine as line } from "../outcomeLine.js";

/**
 * Rock Paper Scissors sounds between two views of the same game (CC-103): the hands opening when a round is
 * revealed, then whether you won or lost that round. On the last round the match result sound says it instead,
 * so only the reveal plays. Spectators and drawn rounds hear just the reveal.
 *
 * @param {any} previous  RoomView before the update
 * @param {any} next      RoomView after it
 * @param {string} you    the viewer ("" for spectators)
 * @returns {string[]}
 */
export function rpsSounds(previous, next, you) {
  const { rounds } = next.game.view;
  if (rounds.length <= previous.game.view.rounds.length) {
    return [];
  }
  const { winner } = rounds.at(-1);
  if (you === "" || winner === "" || next.status !== ROOM_STATUS.PLAYING) {
    return [SOUNDS.REVEAL];
  }
  return [SOUNDS.REVEAL, winner === you ? SOUNDS.ROUND_WON : SOUNDS.ROUND_LOST];
}

/**
 * How a Rock Paper Scissors match ended, as the end of the result headline (CC-162): "You won the best of 3".
 * Empty for a reason this version does not know.
 *
 * @param {string} reason  the outcome's reason, such as "best-of-3"
 */
export function rpsReasonPhrase(reason) {
  const match = /^best-of-(\d+)$/.exec(reason);
  return match === null ? "" : `the best of ${match[1]}`;
}

/** The words of a best of N, whatever N is. */
const BEST_OF = Object.freeze({
  won: () => line("Tumne unki chaal padh li.", "You read them."),
  lost: () => line("Achha game tha. Ek aur?", "Good game. Want another?"),
});

/**
 * What Rock Paper Scissors adds to the outcome moments (CC-163): the words of a best of N, and Rocky's tip after a
 * loss, from how Rocky plays at that level. The Hinglish lines are drafts for the owner (docs/tickets/CC-163.md).
 *
 * @type {import("../outcomeLine.js").OutcomeText}
 */
export const RPS_OUTCOME_TEXT = Object.freeze({
  words: (reason) => (/^best-of-\d+$/.test(reason) ? BEST_OF : undefined),
  hint: ({ character, level }) => {
    if (character !== "rocky") return undefined;
    // Hard Rocky learns the player's habits, easy Rocky throws at random (BOT_CHARACTERS).
    return level === "hard"
      ? line("Rocky ne tumhari aadat padh li. Mix karo.", "Rocky read that one. Try mixing it up.")
      : line("Is baar Rocky ki kismat. Ek aur?", "Rocky throws at random. Go again?");
  },
});
