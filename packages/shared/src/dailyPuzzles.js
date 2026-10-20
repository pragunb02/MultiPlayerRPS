import { GAME_IDS } from "./games.js";

/**
 * The daily puzzles (CC-144, ADR-061). Everyone gets the same puzzle of each kind on a day. Part 1 has the chess
 * puzzle. Later parts add an entry here, a referee on the server and a board in the web app.
 */
export const DAILY_PUZZLE_KINDS = Object.freeze({ CHESS: "chess" });

/**
 * @typedef {Object} DailyPuzzleInfo
 * @property {string} id           a DAILY_PUZZLE_KINDS value, also the URL segment of its page
 * @property {string} name         what players call it
 * @property {string} gameId       the game it belongs to, for its art and link preview
 * @property {number} maxMistakes  wrong moves that end the day's attempt
 * @property {number} maxHints     hints a player may take, all optional
 */

/** @type {ReadonlyArray<Readonly<DailyPuzzleInfo>>} */
export const DAILY_PUZZLES = Object.freeze([
  Object.freeze({
    id: DAILY_PUZZLE_KINDS.CHESS,
    name: "Daily chess puzzle",
    gameId: GAME_IDS.CHESS,
    maxMistakes: 3,
    maxHints: 2,
  }),
]);

/**
 * @param {string} id
 * @returns {Readonly<DailyPuzzleInfo> | undefined}
 */
export const getDailyPuzzle = (id) => DAILY_PUZZLES.find((puzzle) => puzzle.id === id);

/** Where a day's attempt stands. `new` means the player has not moved or taken a hint yet. */
export const DAILY_PUZZLE_STATUS = Object.freeze({
  NEW: "new",
  PLAYING: "playing",
  SOLVED: "solved",
  FAILED: "failed",
});

/** The statuses of a day that has ended. Once ended, the day takes no more moves and shows its solution. */
export const DAILY_PUZZLE_ENDED = Object.freeze([DAILY_PUZZLE_STATUS.SOLVED, DAILY_PUZZLE_STATUS.FAILED]);

/**
 * Whether a day's attempt has ended, solved or failed.
 *
 * @param {string} status  a DAILY_PUZZLE_STATUS value
 */
export const isDailyPuzzleEnded = (status) => DAILY_PUZZLE_ENDED.includes(status);

/**
 * One mark per move the player had to find, for the share grid. It says how a move went and never which move it
 * was, so the grid gives nothing away.
 */
export const DAILY_PUZZLE_MARKS = Object.freeze({
  FIRST_TRY: "firstTry",
  AFTER_MISTAKES: "afterMistakes",
  FAILED: "failed",
  NOT_REACHED: "notReached",
});

/** What a move did. */
export const DAILY_PUZZLE_OUTCOMES = Object.freeze({
  CORRECT: "correct",
  WRONG: "wrong",
  SOLVED: "solved",
  FAILED: "failed",
});

/**
 * Why the server refused a move or a hint, in `error.details.reason`. An illegal move is a 400 answer, every
 * other refusal a 409.
 */
export const DAILY_PUZZLE_REFUSALS = Object.freeze({
  /** The move cannot be played in the position. It costs no mistake. */
  ILLEGAL_MOVE: "illegalMove",
  /** The day has turned. The page loads the new puzzle. */
  DAY_OVER: "dayOver",
  /** The day's attempt has ended, solved or failed. */
  FINISHED: "finished",
  /** Every hint was taken. */
  NO_HINTS_LEFT: "noHintsLeft",
  /** Another tab changed the attempt at the same moment. The page loads it again. */
  CHANGED: "changed",
});
