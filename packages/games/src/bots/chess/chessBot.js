import { CHESS_ACTIONS, GAME_IDS } from "@classicade/shared";
import { randomIndex } from "../../rng.js";
import { defineBot } from "../bot.js";
import { legalMoves, makeMove, moveFromSan, parseFen, squareName, START_FEN } from "./board.js";
import { scoreMoves, searchMove } from "./search.js";

export const CHESS_BOT_LEVELS = Object.freeze({ BEGINNER: "beginner", CLUB: "club", STRONG: "strong" });

/** How often Beginner plays any legal move at all, which is what makes it beatable for new players. */
const BEGINNER_BLUNDER_RATE = 0.3;
/** How far Beginner misjudges the moves it does think about, in hundredths of a pawn either way. */
const BEGINNER_NOISE = 80;

/**
 * How far each searching level may look. Budgets count positions, not milliseconds, so a level plays the
 * same on every machine and every replay. On an Apple M4 Pro Club answers in about 10 ms and Strong in about
 * 140 ms on average, never above about 250 ms, inside the 300 ms target (docs/tickets/CC-040.md).
 */
export const CHESS_SEARCH_LIMITS = Object.freeze({
  [CHESS_BOT_LEVELS.CLUB]: Object.freeze({ maxDepth: 3, maxNodes: 20_000 }),
  [CHESS_BOT_LEVELS.STRONG]: Object.freeze({ maxDepth: 8, maxNodes: 60_000 }),
});

const PROMOTION_LETTERS = " pnbrqk";

/** Rebuilds the game on the bot's own board, so it knows which positions were already seen. */
function boardFor(view) {
  const board = parseFen(START_FEN);
  for (const san of view.moves) {
    makeMove(board, moveFromSan(board, san));
  }
  return board;
}

function beginner(board, rng) {
  const scored = scoreMoves(board, { depth: 1 });
  if (rng() < BEGINNER_BLUNDER_RATE) {
    return scored[randomIndex(rng, scored.length)].move;
  }
  const judged = scored.map(({ move, score }) => ({
    move,
    score: score + (rng() * 2 - 1) * BEGINNER_NOISE,
  }));
  return judged.reduce((best, entry) => (entry.score > best.score ? entry : best)).move;
}

const toRawMove = ({ from, to, promotion }) =>
  promotion === 0
    ? { type: CHESS_ACTIONS.MOVE, from: squareName(from), to: squareName(to) }
    : {
        type: CHESS_ACTIONS.MOVE,
        from: squareName(from),
        to: squareName(to),
        promotion: PROMOTION_LETTERS[promotion],
      };

/**
 * Chess bots built on a small engine of our own (board.js, search.js). Stockfish would be far stronger
 * than any of these levels need, and a few hundred lines keep the package free of a large binary.
 * They play moves only: they never resign, offer a draw or accept one.
 */
export const chessBot = defineBot({
  gameId: GAME_IDS.CHESS,
  levels: [
    {
      id: CHESS_BOT_LEVELS.BEGINNER,
      name: "Beginner",
      description: "Knows how the pieces move and grabs free pieces, but blunders often.",
    },
    {
      id: CHESS_BOT_LEVELS.CLUB,
      name: "Club player",
      description: "Plays sensible moves and spots short tactics a few moves deep.",
    },
    {
      id: CHESS_BOT_LEVELS.STRONG,
      name: "Strong",
      description: "Looks several moves ahead and punishes every mistake.",
    },
  ],
  chooseMove({ view, rng, difficulty }) {
    const board = boardFor(view);
    if (legalMoves(board).length === 0) {
      throw new RangeError("The game is over, there is no move to choose");
    }
    const move =
      difficulty === CHESS_BOT_LEVELS.BEGINNER
        ? beginner(board, rng)
        : searchMove(board, { ...CHESS_SEARCH_LIMITS[difficulty], rng }).move;
    return toRawMove(move);
  },
});
