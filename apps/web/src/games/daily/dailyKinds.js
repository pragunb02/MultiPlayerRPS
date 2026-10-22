import { DAILY_PUZZLE_KINDS, DAILY_PUZZLE_OUTCOMES } from "@classicade/shared";
import { colourName, opposite } from "../chess/chessColours.js";
import { lazyBoard } from "../lazyBoard.js";

// The chess puzzle's board loads on demand, with chess.js, the first time a player opens it.
const ChessPuzzle = lazyBoard(() => import("./ChessPuzzle.jsx"), "ChessPuzzle");

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const capital = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;

/** What a screen reader hears after a chess move: the move, whether it was right, and the reply. */
function announceChess({ outcome, played, reply, puzzle }) {
  const left = puzzle.maxMistakes - puzzle.mistakes;
  if (outcome === DAILY_PUZZLE_OUTCOMES.CORRECT) {
    const replier = capital(colourName(opposite(puzzle.position.player)));
    return `${played.san} is correct. ${replier} played ${reply.san}. Find the next move.`;
  }
  if (outcome === DAILY_PUZZLE_OUTCOMES.SOLVED) {
    return `${played.san}. Solved!`;
  }
  if (outcome === DAILY_PUZZLE_OUTCOMES.WRONG) {
    return `${played.san} is not the move. ${left === 1 ? "1 try" : `${left} tries`} left.`;
  }
  return `${played.san} is not the move. No tries left. The solution is below.`;
}

/**
 * What each kind of daily puzzle brings to the web app (CC-144, ADR-061): its board, the line that says what to
 * do, and what a screen reader hears after a move. A new kind, such as Ultimate Tic Tac Toe, adds one entry here
 * and its board.
 *
 * @typedef {Object} DailyKindView
 * @property {import("react").ComponentType<any>} Board  takes `{ puzzle, interactive, reason, onMove }`
 * @property {(puzzle: any) => string} task  what the player has to do, in a sentence
 * @property {(answer: any) => string} announce  the words for the server's answer to a move
 *
 * @type {Readonly<Record<string, Readonly<DailyKindView>>>}
 */
export const DAILY_KINDS = Object.freeze({
  [DAILY_PUZZLE_KINDS.CHESS]: Object.freeze({
    Board: ChessPuzzle,
    task: (puzzle) =>
      `${capital(colourName(puzzle.position.player))} to move. Find ${plural(puzzle.steps, "move")}.`,
    announce: announceChess,
  }),
});
