import { DAILY_PUZZLE_MARKS, DAILY_PUZZLE_OUTCOMES, DAILY_PUZZLE_STATUS } from "@classicade/shared";

/**
 * How a day's attempt at a puzzle changes, as pure functions (CC-144, ADR-061). They work for every kind: the
 * kind's referee judges a move, and these keep count.
 *
 * @typedef {import("../../data/dailyPuzzleAccessor.js").DailyPuzzleAttempt} DailyPuzzleAttempt
 */

/**
 * What a player who has not moved or taken a hint yet sees. Nothing is stored for them until they do.
 */
export const BLANK_ATTEMPT = Object.freeze({
  status: DAILY_PUZZLE_STATUS.NEW,
  found: Object.freeze([]),
  marks: Object.freeze([]),
  mistakes: 0,
  hints: Object.freeze([]),
});

/** Whether the attempt has ended, solved or failed. */
export const isEnded = ({ status }) =>
  status === DAILY_PUZZLE_STATUS.SOLVED || status === DAILY_PUZZLE_STATUS.FAILED;

/** Hints taken at the move the player is looking for now. */
export const hintsAt = ({ hints, found }) => hints[found.length] ?? 0;

/**
 * A new attempt, started by the player's first move or hint.
 *
 * @param {{ playerId: string, kind: string, day: string, puzzleId: string, steps: number, now: number }} input
 *   steps: moves the player has to find
 * @returns {DailyPuzzleAttempt}
 */
export const newAttempt = ({ playerId, kind, day, puzzleId, steps, now }) => ({
  playerId,
  kind,
  day,
  puzzleId,
  status: DAILY_PUZZLE_STATUS.PLAYING,
  found: [],
  marks: Array(steps).fill(0),
  mistakes: 0,
  hints: Array(steps).fill(0),
  streak: 0,
  best: 0,
  version: 0,
  startedAt: now,
  updatedAt: now,
  finishedAt: 0,
});

const withCount = (counts, index) => counts.map((count, at) => (at === index ? count + 1 : count));

/**
 * The attempt after a judged legal move. A correct move is kept. A wrong one is a mistake at the move being looked
 * for and leaves the position as it was. The last mistake allowed ends the attempt as failed.
 *
 * @param {{
 *   attempt: Readonly<DailyPuzzleAttempt>,
 *   judged: { correct: boolean, solved?: boolean, played: { uci: string } },
 *   maxMistakes: number,
 *   now: number,
 * }} input
 * @returns {{ attempt: DailyPuzzleAttempt, outcome: string }}  outcome: a DAILY_PUZZLE_OUTCOMES value
 */
export function afterMove({ attempt, judged, maxMistakes, now }) {
  if (judged.correct) {
    const found = [...attempt.found, judged.played.uci];
    const solved = judged.solved === true;
    return {
      attempt: {
        ...attempt,
        found,
        updatedAt: now,
        ...(solved && { status: DAILY_PUZZLE_STATUS.SOLVED, finishedAt: now }),
      },
      outcome: solved ? DAILY_PUZZLE_OUTCOMES.SOLVED : DAILY_PUZZLE_OUTCOMES.CORRECT,
    };
  }
  const mistakes = attempt.mistakes + 1;
  const failed = mistakes >= maxMistakes;
  return {
    attempt: {
      ...attempt,
      marks: withCount(attempt.marks, attempt.found.length),
      mistakes,
      updatedAt: now,
      ...(failed && { status: DAILY_PUZZLE_STATUS.FAILED, finishedAt: now }),
    },
    outcome: failed ? DAILY_PUZZLE_OUTCOMES.FAILED : DAILY_PUZZLE_OUTCOMES.WRONG,
  };
}

/**
 * The attempt after one more hint at the move being looked for.
 *
 * @param {{ attempt: Readonly<DailyPuzzleAttempt>, now: number }} input
 * @returns {DailyPuzzleAttempt}
 */
export const afterHint = ({ attempt, now }) => ({
  ...attempt,
  hints: withCount(attempt.hints, attempt.found.length),
  updatedAt: now,
});

/**
 * One mark per move the player had to find, for the share grid: found first time, found after a mistake, where a
 * failed attempt ended, or not reached. A puzzle solved early by a checkmate ends its grid there.
 *
 * @param {{ attempt: { status: string, found: ReadonlyArray<string>, marks: ReadonlyArray<number> }, steps: number }} input
 * @returns {string[]}  DAILY_PUZZLE_MARKS values
 */
export function gridOf({ attempt, steps }) {
  const shown = attempt.status === DAILY_PUZZLE_STATUS.SOLVED ? attempt.found.length : steps;
  return Array.from({ length: shown }, (_, index) => {
    if (index < attempt.found.length) {
      return attempt.marks[index] === 0 ? DAILY_PUZZLE_MARKS.FIRST_TRY : DAILY_PUZZLE_MARKS.AFTER_MISTAKES;
    }
    return index === attempt.found.length && attempt.status === DAILY_PUZZLE_STATUS.FAILED
      ? DAILY_PUZZLE_MARKS.FAILED
      : DAILY_PUZZLE_MARKS.NOT_REACHED;
  });
}
