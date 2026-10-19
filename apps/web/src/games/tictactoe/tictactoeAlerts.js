import { SOUNDS } from "../../lib/sound/sounds.js";
import { outcomeLine as line, wordsFrom } from "../outcomeLine.js";

const filled = (room) => room.game.view.board.filter((cell) => cell !== "").length;

/**
 * Tic-Tac-Toe sounds between two views of the same game (CC-103): a pop when a mark lands, and a flourish when a
 * line is completed.
 *
 * @param {any} previous  RoomView before the update
 * @param {any} next      RoomView after it
 * @returns {string[]}
 */
export function tictactoeSounds(previous, next) {
  const placed = filled(next) > filled(previous) ? [SOUNDS.PLACE] : [];
  const lined = previous.game.view.winningLine.length === 0 && next.game.view.winningLine.length > 0;
  return lined ? [...placed, SOUNDS.LINE] : placed;
}

const REASON_PHRASES = Object.freeze({
  "three-in-a-row": "with three in a row",
  "board-full": "with a full board",
});

/**
 * How a Tic-Tac-Toe game ended, as the end of the result headline (CC-162): "You won with three in a row".
 * Empty for a reason this version does not know.
 *
 * @param {string} reason  the outcome's reason
 */
export const tictactoeReasonPhrase = (reason) => REASON_PHRASES[reason] ?? "";

/**
 * What Tic-Tac-Toe adds to the outcome moments (CC-163): the words of each ending, and Pip's tip after a loss. The
 * Hinglish lines are drafts for the owner (docs/tickets/CC-163.md).
 *
 * @type {import("../outcomeLine.js").OutcomeText}
 */
export const TICTACTOE_OUTCOME_TEXT = Object.freeze({
  words: wordsFrom({
    "three-in-a-row": {
      // "You lost with three in a row" sounds as if the loser made the line (CC-162).
      lostPhrase: "to three in a row",
      won: () => line("Badhiya line.", "Nice line."),
      lost: () =>
        line("Unki line pehle bani. Agli baar nazar rakho.", "They got three first. Watch their lines."),
    },
    "board-full": { drew: () => line("Dono taraf se perfect khel.", "Perfect play from both sides.") },
  }),
  hint: ({ character, level }) => {
    if (character !== "pip") return undefined;
    // Unbeatable Pip can only be held to a draw, so the tip says that a draw is the goal.
    return level === "hard"
      ? line("Pip haarta nahi. Draw bhi jeet hai.", "Pip never loses. A draw is a win.")
      : line("Pip ko corner pasand hai. Pehle corner lo.", "Pip loves a corner. Take one first.");
  },
});
