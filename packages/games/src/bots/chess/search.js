import { randomIndex } from "../../rng.js";
import {
  BISHOP,
  colorOf,
  fileOf,
  inCheck,
  KING,
  KNIGHT,
  legalMoves,
  makeMove,
  PAWN,
  QUEEN,
  rankOf,
  ROOK,
  typeOf,
  unmakeMove,
  WHITE,
} from "./board.js";

/**
 * How the chess bot thinks: it scores positions by material and piece placement, and looks ahead with
 * alpha beta search, which skips lines that cannot change the decision. Scores are in hundredths of a
 * pawn, from the view of the side to move.
 */

/** Larger than any position score. A mate scores just below it, sooner mates higher. */
export const MATE = 100_000;
const INFINITY = MATE + 1;
/** Any score this close to MATE is a forced mate, so searching deeper cannot change the decision. */
const FORCED_MATE = MATE - 1_000;
/** How far from the root a check still earns an extra move of depth. */
const MAX_PLY = 64;

const VALUES = Object.freeze([0, 100, 320, 330, 500, 900, 0]);

/**
 * Piece square tables from Tomasz Michniewski's "Simplified Evaluation Function": small bonuses that
 * push pieces to good squares (knights to the centre, rooks to the seventh rank, the king to safety and,
 * once queens and rooks are mostly gone, to the centre). Written from White's side, eighth rank first.
 */
// prettier-ignore
const TABLES = Object.freeze({
  [PAWN]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  [KNIGHT]: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  [BISHOP]: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  [ROOK]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  [QUEEN]: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  [KING]: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
});

// prettier-ignore
const KING_ENDGAME = Object.freeze([
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
]);

/** Below this much knight, bishop, rook and queen material (both sides together) it is an endgame. */
const ENDGAME_MATERIAL = 1800;
/** A material lead this big means the leader should hunt the other king rather than wait. */
const MOP_UP_LEAD = 400;

const tableIndex = (square, color) =>
  color === WHITE ? (7 - rankOf(square)) * 8 + fileOf(square) : rankOf(square) * 8 + fileOf(square);
const centreDistance = (square) =>
  Math.max(3 - rankOf(square), rankOf(square) - 4) + Math.max(3 - fileOf(square), fileOf(square) - 4);
const kingDistance = (a, b) => Math.abs(rankOf(a) - rankOf(b)) + Math.abs(fileOf(a) - fileOf(b));

/**
 * Scores a position for the side to move: material, piece placement and, when one side is far ahead
 * in an endgame, a bonus for driving the lone king to the edge with its own king close by. Without
 * that bonus the search cannot see far enough to find the mate and just shuffles.
 *
 * @param {import("./board.js").Board} board
 */
export function evaluate(board) {
  const material = [0, 0];
  const placement = [0, 0];
  const kingPlacement = [0, 0];
  let officers = 0;
  board.squares.forEach((piece, square) => {
    if (piece === 0) {
      return;
    }
    const color = colorOf(piece);
    const type = typeOf(piece);
    const index = tableIndex(square, color);
    material[color] += VALUES[type];
    if (type === KING) {
      kingPlacement[color] = KING_ENDGAME[index];
      placement[color] += TABLES[KING][index];
      return;
    }
    placement[color] += TABLES[type][index];
    officers += type === PAWN ? 0 : VALUES[type];
  });
  const scores = [material[0] + placement[0], material[1] + placement[1]];
  if (officers <= ENDGAME_MATERIAL) {
    for (const color of [0, 1]) {
      scores[color] += kingPlacement[color] - TABLES[KING][tableIndex(board.kings[color], color)];
    }
    const lead = material[0] - material[1];
    if (Math.abs(lead) >= MOP_UP_LEAD) {
      const leader = lead > 0 ? 0 : 1;
      const lone = board.kings[leader ^ 1];
      scores[leader] += 10 * centreDistance(lone) + 4 * (14 - kingDistance(board.kings[leader], lone));
    }
  }
  return scores[board.side] - scores[board.side ^ 1];
}

/** Whether the position already happened with the same side to move since the last capture or pawn move. */
function isRepetition(board) {
  const { undo, hash, halfmove } = board;
  const oldest = Math.max(0, undo.length - halfmove);
  for (let index = undo.length - 2; index >= oldest; index -= 2) {
    if (undo[index].hash === hash) {
      return true;
    }
  }
  return false;
}

/** Captures of valuable pieces by cheap ones first, then promotions, then moves that refuted a sibling. */
function orderScore(move, killers) {
  if (move.captured !== 0) {
    return 10_000 + 10 * VALUES[typeOf(move.captured)] - VALUES[typeOf(move.piece)];
  }
  if (move.promotion !== 0) {
    return 9_000 + VALUES[move.promotion];
  }
  return killers.some((killer) => sameMove(killer, move)) ? 8_000 : 0;
}

const sameMove = (a, b) => a.from === b.from && a.to === b.to && a.promotion === b.promotion;

/** Sorting is stable, so moves that score the same keep the order they came in. */
const ordered = (moves, killers) =>
  moves
    .map((move) => ({ move, score: orderScore(move, killers) }))
    .sort((a, b) => b.score - a.score)
    .map(({ move }) => move);

/**
 * Searches the position on `board`, which it uses in place and leaves as it found it.
 *
 * @param {import("./board.js").Board} board
 * @param {{ maxNodes: number }} limits  stop once this many positions were looked at. Counting positions
 *   instead of milliseconds keeps the bot deterministic: the same game always gets the same answer.
 */
function createSearch(board, { maxNodes }) {
  // Search never goes further than the extension cap plus the deepest level's depth.
  const killers = Array.from({ length: 2 * MAX_PLY }, () => []);
  const run = { nodes: 0, stopped: false, mayStop: false };

  const tick = () => {
    run.nodes += 1;
    if (run.mayStop && run.nodes > maxNodes) {
      run.stopped = true;
    }
    return run.stopped;
  };

  /**
   * Follows captures and promotions until the position is quiet, so a score is never taken in the middle
   * of an exchange. It always ends, because every such move removes a piece or a pawn.
   */
  function quiesce(alpha, beta) {
    if (tick()) {
      return 0;
    }
    const standPat = evaluate(board);
    if (standPat >= beta) {
      return standPat;
    }
    let best = Math.max(alpha, standPat);
    for (const move of ordered(legalMoves(board, { tacticalOnly: true }), [])) {
      makeMove(board, move);
      const score = -quiesce(-beta, -best);
      unmakeMove(board);
      if (run.stopped) {
        return 0;
      }
      if (score >= beta) {
        return score;
      }
      best = Math.max(best, score);
    }
    return best;
  }

  function negamax(depth, alpha, beta, ply) {
    if (tick()) {
      return 0;
    }
    if (board.halfmove >= 100 || isRepetition(board)) {
      return 0;
    }
    const checked = inCheck(board);
    // A side in check has few replies, so looking one move further costs little and finds mates. The
    // cap stops a rare long chain of checks answered by checks from going on and on.
    const remaining = checked && ply < MAX_PLY ? depth + 1 : depth;
    if (remaining <= 0) {
      return quiesce(alpha, beta);
    }
    const moves = legalMoves(board);
    if (moves.length === 0) {
      return checked ? -MATE + ply : 0;
    }
    let best = -INFINITY;
    let floor = alpha;
    for (const move of ordered(moves, killers[ply])) {
      makeMove(board, move);
      const score = -negamax(remaining - 1, -beta, -floor, ply + 1);
      unmakeMove(board);
      if (run.stopped) {
        return 0;
      }
      best = Math.max(best, score);
      floor = Math.max(floor, score);
      if (floor >= beta) {
        if (move.captured === 0) {
          killers[ply] = [move, ...killers[ply].filter((killer) => !sameMove(killer, move))].slice(0, 2);
        }
        break;
      }
    }
    return best;
  }

  /** Every root move's score, exact when `exact` is set, otherwise exact only for the best one. */
  function searchRoot(moves, depth, exact) {
    let alpha = -INFINITY;
    return moves.map((move) => {
      makeMove(board, move);
      const score = -negamax(depth - 1, -INFINITY, exact ? INFINITY : -alpha, 1);
      unmakeMove(board);
      alpha = Math.max(alpha, score);
      // Negating a draw's 0 gives -0. Adding 0 makes it a plain 0 again, so draws compare and print as 0.
      return { move, score: score + 0 };
    });
  }

  return { run, searchRoot };
}

/**
 * Every legal move with its exact score after looking `depth` moves ahead. Used by the weakest level,
 * which needs to know how good each move is to make believable mistakes.
 *
 * @param {import("./board.js").Board} board
 * @param {{ depth: number }} options
 * @returns {Array<{ move: import("./board.js").Move, score: number }>}
 */
export function scoreMoves(board, { depth }) {
  return createSearch(board, { maxNodes: Infinity }).searchRoot(legalMoves(board), depth, true);
}

/**
 * The best move found by searching one move deeper each round (iterative deepening) until `maxDepth`
 * or the position budget. A round cut short by the budget is thrown away, the last complete round
 * decides. Each round starts with the previous round's best move, which makes cut offs come early.
 * Moves are shuffled with `rng` first, so between equally good moves the choice varies from game to game.
 *
 * @param {import("./board.js").Board} board   must have at least one legal move
 * @param {{ maxDepth: number, maxNodes: number, rng: import("../../rng.js").Rng }} options
 * @returns {{ move: import("./board.js").Move, score: number, depth: number, nodes: number }}
 */
export function searchMove(board, { maxDepth, maxNodes, rng }) {
  const shuffled = legalMoves(board);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = randomIndex(rng, index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  const { run, searchRoot } = createSearch(board, { maxNodes });
  let moves = ordered(shuffled, []);
  let found = { move: moves[0], score: 0, depth: 0 };
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const scored = searchRoot(moves, depth, false);
    if (run.stopped) {
      break;
    }
    const best = scored.reduce((top, entry) => (entry.score > top.score ? entry : top));
    found = { move: best.move, score: best.score, depth };
    run.mayStop = true;
    moves = [best.move, ...moves.filter((move) => move !== best.move)];
    if (Math.abs(best.score) >= FORCED_MATE) {
      break;
    }
  }
  return { ...found, nodes: run.nodes };
}
