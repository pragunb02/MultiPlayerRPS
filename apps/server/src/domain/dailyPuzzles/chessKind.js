import {
  chessHint,
  chessPuzzlePosition,
  chessPuzzleSteps,
  chessSolution,
  judgeChessMove,
} from "@classicade/games";
import { DAILY_PUZZLE_KINDS, getDailyPuzzle } from "@classicade/shared";

/**
 * What the daily puzzle component needs from a kind of puzzle (ADR-061). The chess kind below is the first. An
 * Ultimate Tic Tac Toe or RPS kind gives the same functions over its own referee and set.
 *
 * @typedef {Object} PuzzleKind
 * @property {string} id             a DAILY_PUZZLE_KINDS value
 * @property {number} maxMistakes
 * @property {number} maxHints
 * @property {number} count          puzzles in the set
 * @property {(index: number) => any} puzzleAt
 * @property {(id: string) => any} puzzleById  throws a RangeError for an id not in the set
 * @property {(puzzle: any) => number} steps    moves the player has to find
 * @property {(puzzle: any) => number} rating
 * @property {(input: { puzzle: any, found: ReadonlyArray<string> }) => object} position  what the player sees
 * @property {(input: { puzzle: any, found: ReadonlyArray<string>, move: object }) => any} judge
 * @property {(input: { puzzle: any, found: ReadonlyArray<string>, level: number }) => string} hint
 * @property {(puzzle: any) => string[]} solution  shown once the attempt has ended
 * @property {(puzzle: any) => string} sourceUrl   where the puzzle came from, shown once the attempt has ended
 */

/**
 * The daily chess puzzle, on the chess.js referee (ADR-041) and the curated Lichess set. The set is checked
 * puzzle by puzzle in `persistence/puzzleCatalog.test.js`, so a broken one fails the build, not the boot.
 *
 * @param {{ puzzles: ReadonlyArray<{ id: string, fen: string, moves: ReadonlyArray<string>, rating: number, themes: ReadonlyArray<string> }> }} deps
 *   puzzles: in the order the days use them
 * @returns {Readonly<PuzzleKind>}
 */
export function createChessKind({ puzzles }) {
  const byId = new Map(puzzles.map((puzzle) => [puzzle.id, puzzle]));
  const { id, maxMistakes, maxHints } = getDailyPuzzle(DAILY_PUZZLE_KINDS.CHESS);

  return Object.freeze({
    id,
    maxMistakes,
    maxHints,
    count: puzzles.length,
    puzzleAt: (index) => puzzles[index],
    puzzleById(puzzleId) {
      if (!byId.has(puzzleId)) {
        throw new RangeError(`No chess puzzle ${puzzleId} in the set`);
      }
      return byId.get(puzzleId);
    },
    steps: chessPuzzleSteps,
    rating: (puzzle) => puzzle.rating,
    position: chessPuzzlePosition,
    judge: judgeChessMove,
    hint: chessHint,
    solution: chessSolution,
    sourceUrl: (puzzle) => `https://lichess.org/training/${encodeURIComponent(puzzle.id)}`,
  });
}
