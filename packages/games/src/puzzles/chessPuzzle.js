import { Chess } from "chess.js";

/**
 * The referee for chess puzzles from the Lichess puzzle database (CC-144, ADR-061). It holds no puzzles. The server
 * keeps those, so no answer can reach a browser by importing this package.
 *
 * A puzzle is a position and a list of moves in UCI. The first move is the opponent's: it is played to reach the
 * position the player sees. After it the player's moves and the opponent's replies take turns, and the player
 * has the last move. Every move of the player is the only good move, except that any checkmate wins, as on Lichess.
 *
 * @typedef {Object} ChessPuzzle
 * @property {string} id         the Lichess puzzle id
 * @property {string} fen        the position before the opponent's first move
 * @property {ReadonlyArray<string>} moves  the opponent's first move, then the solution with the replies, in UCI
 * @property {number} rating     the Lichess puzzle rating
 * @property {ReadonlyArray<string>} themes  the Lichess theme names, such as "fork" or "mateIn2"
 *
 * @typedef {{ from: string, to: string, promotion?: string }} BoardMove
 */

export const PIECE_WORDS = Object.freeze({
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
});

/**
 * The first hint names the idea. A tactic is more useful than a goal, so tactics are looked for first, in this
 * order. The names are Lichess' own theme names (https://lichess.org/training/themes).
 */
const TACTIC_HINTS = Object.freeze([
  ["mateIn1", "Look for checkmate in one move."],
  ["mateIn2", "Look for checkmate in two moves."],
  ["mateIn3", "Look for checkmate in three moves."],
  ["mateIn4", "Look for checkmate in four moves."],
  ["mateIn5", "Look for checkmate."],
  ["backRankMate", "Look at the back rank."],
  ["smotheredMate", "Look for a smothered mate."],
  ["fork", "Look for a fork."],
  ["pin", "Look for a pin."],
  ["skewer", "Look for a skewer."],
  ["discoveredAttack", "Look for a discovered attack."],
  ["doubleCheck", "Look for a double check."],
  ["hangingPiece", "Look for a piece nobody guards."],
  ["trappedPiece", "Look for a piece that cannot escape."],
  ["deflection", "Pull a defender away."],
  ["attraction", "Lure a piece onto a bad square."],
  ["capturingDefender", "Take the piece that defends."],
  ["promotion", "Think about promoting a pawn."],
  ["advancedPawn", "Your advanced pawn matters."],
  ["sacrifice", "A sacrifice may work here."],
  ["quietMove", "The best move is a quiet one."],
  ["zugzwang", "Make a move that leaves your opponent only bad moves."],
  ["mate", "Look for checkmate."],
  ["crushing", "Look for a way to win material."],
  ["advantage", "Look for a way to win material."],
  ["equality", "Find the move that saves the game."],
]);
const NO_THEME_HINT = "Look for the strongest move.";

/** The highest hint level: the idea, then the piece to move. */
export const CHESS_HINT_LEVELS = 2;

const toBoardMove = (uci) => ({
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
  ...(uci.length === 5 && { promotion: uci[4] }),
});
const uciOf = ({ from, to, promotion }) => `${from}${to}${promotion ?? ""}`;

/**
 * Plays a move on the board, or answers undefined when it is not legal there. chess.js throws for an illegal move,
 * which here is an ordinary answer.
 */
function tryMove(chess, move) {
  try {
    return chess.move(move);
  } catch {
    return undefined;
  }
}

/**
 * The board after the opponent's first move and the moves found so far, each followed by its reply. The last
 * move played is kept for the board's highlight.
 */
function replay(puzzle, found) {
  const chess = new Chess(puzzle.fen);
  let last = chess.move(toBoardMove(puzzle.moves[0]));
  const line = [];
  found.forEach((uci, index) => {
    last = chess.move(toBoardMove(uci));
    line.push(last.san);
    const reply = puzzle.moves[2 * index + 2];
    if (reply !== undefined && !chess.isCheckmate()) {
      last = chess.move(toBoardMove(reply));
      line.push(last.san);
    }
  });
  return { chess, last, line };
}

/**
 * How many moves the player has to find.
 *
 * @param {Readonly<ChessPuzzle>} puzzle
 * @returns {number}
 */
export const chessPuzzleSteps = (puzzle) => puzzle.moves.length / 2;

/**
 * The position the player sees, after the moves they found so far. It holds no move still to be found.
 *
 * @param {{ puzzle: Readonly<ChessPuzzle>, found: ReadonlyArray<string> }} input  found: the player's accepted
 *   moves in UCI, oldest first
 * @returns {{ fen: string, toMove: "w" | "b", lastMove: { from: string, to: string, san: string }, line: string[] }}
 *   line: every move after the opponent's first one, in SAN
 */
export function chessPuzzlePosition({ puzzle, found }) {
  const { chess, last, line } = replay(puzzle, found);
  return {
    fen: chess.fen(),
    toMove: /** @type {"w" | "b"} */ (chess.turn()),
    lastMove: { from: last.from, to: last.to, san: last.san },
    line,
  };
}

/**
 * Judges the player's next move. A legal move is correct when it is the solution's move or when it gives
 * checkmate. A correct move that does not end the puzzle comes back with the opponent's reply.
 *
 * @param {{ puzzle: Readonly<ChessPuzzle>, found: ReadonlyArray<string>, move: BoardMove }} input
 * @returns {{ legal: false }
 *   | { legal: true, correct: false, played: { uci: string, san: string } }
 *   | { legal: true, correct: true, solved: boolean, played: { uci: string, san: string },
 *       reply?: { uci: string, san: string, from: string, to: string } }}
 */
export function judgeChessMove({ puzzle, found, move }) {
  const { chess } = replay(puzzle, found);
  const made = tryMove(chess, move);
  if (made === undefined) {
    return { legal: false };
  }
  const played = { uci: uciOf(made), san: made.san };
  const expected = puzzle.moves[2 * found.length + 1];
  if (played.uci !== expected && !chess.isCheckmate()) {
    return { legal: true, correct: false, played };
  }
  const reply = puzzle.moves[2 * found.length + 2];
  if (reply === undefined || chess.isCheckmate()) {
    return { legal: true, correct: true, solved: true, played };
  }
  const answer = chess.move(toBoardMove(reply));
  return {
    legal: true,
    correct: true,
    solved: false,
    played,
    reply: { uci: reply, san: answer.san, from: answer.from, to: answer.to },
  };
}

/**
 * A hint for the player's next move. Level 1 is the idea, level 2 the piece to move.
 *
 * @param {{ puzzle: Readonly<ChessPuzzle>, found: ReadonlyArray<string>, level: number }} input
 * @returns {string}
 * @throws {RangeError} for a level the referee has no hint for
 */
export function chessHint({ puzzle, found, level }) {
  if (level === 1) {
    return TACTIC_HINTS.find(([theme]) => puzzle.themes.includes(theme))?.[1] ?? NO_THEME_HINT;
  }
  if (level === 2) {
    const { chess } = replay(puzzle, found);
    const { from } = toBoardMove(puzzle.moves[2 * found.length + 1]);
    return `Move your ${PIECE_WORDS[chess.get(from).type]} on ${from}.`;
  }
  throw new RangeError(`No chess hint at level ${level}`);
}

/**
 * The whole solution in SAN, with the opponent's replies, for after the attempt has ended.
 *
 * @param {Readonly<ChessPuzzle>} puzzle
 * @returns {string[]}
 */
export function chessSolution(puzzle) {
  const chess = new Chess(puzzle.fen);
  return puzzle.moves.map((uci) => chess.move(toBoardMove(uci)).san).slice(1);
}

/**
 * Checks one puzzle of the set: its fields, and that every move is legal in turn. The tests check the whole set
 * this way, and the curation script every puzzle it picks, so a broken puzzle stops a build instead of a player.
 *
 * @param {unknown} puzzle
 * @throws {Error} naming the puzzle and what is wrong with it
 */
export function assertChessPuzzle(puzzle) {
  const { id, fen, moves, rating, themes } = /** @type {any} */ (puzzle);
  if (typeof id !== "string" || id === "") {
    throw new Error("A chess puzzle needs an id");
  }
  const fail = (why, cause) => {
    throw new Error(`Chess puzzle ${id}: ${why}`, { cause });
  };
  if (!Number.isInteger(rating)) fail("the rating must be a whole number");
  if (!Array.isArray(themes) || !themes.every((theme) => typeof theme === "string")) {
    fail("the themes must be a list of names");
  }
  if (!Array.isArray(moves) || moves.length < 2 || moves.length % 2 !== 0) {
    fail("the moves must be the opponent's first move and then pairs, ending with the player's");
  }
  try {
    const chess = new Chess(fen);
    moves.forEach((uci) => chess.move(toBoardMove(uci)));
  } catch (err) {
    fail("a move is not legal, or the position is not a FEN", err);
  }
}
