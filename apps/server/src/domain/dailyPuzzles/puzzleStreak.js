import { DAILY_PUZZLE_STATUS, isDailyPuzzleEnded } from "@classicade/shared";
import { addDays } from "../../utils/indiaTime.js";

/**
 * The streak rules of the daily puzzles (ADR-061), as pure functions of the days a player ended. Each kind has its
 * own streak. The days are the puzzle's days, so they turn when the puzzle does.
 *
 * @typedef {{ day: string, status: string, streak: number, best: number }} EndedDay
 * @typedef {{ streak: number, best: number }} StreakAfter
 */

/**
 * The streak once a day ends. A solved day adds one when yesterday was solved too and starts again at 1 otherwise.
 * A failed day ends the streak, as a failed Wordle does. The best streak is kept either way.
 *
 * @param {{ previous: ReadonlyArray<EndedDay>, day: string, solved: boolean }} input  previous: the latest ended day
 *   before this one, or nothing
 * @returns {StreakAfter}
 */
export function streakAfter({ previous, day, solved }) {
  const last = previous[0];
  const carried =
    last !== undefined && last.status === DAILY_PUZZLE_STATUS.SOLVED && last.day === addDays(day, -1)
      ? last.streak
      : 0;
  const streak = solved ? carried + 1 : 0;
  return { streak, best: Math.max(last?.best ?? 0, streak) };
}

/**
 * The streak as the player sees it today. One last extended yesterday is at risk until today's puzzle is solved.
 * One whose last day was failed or is older than yesterday is 0.
 *
 * @param {{ latest: ReadonlyArray<EndedDay>, today: string }} input  latest: the latest ended day up to today, or
 *   nothing
 * @returns {{ current: number, best: number, playedToday: boolean, atRisk: boolean }}
 */
export function streakView({ latest, today }) {
  const last = latest[0];
  if (last === undefined) {
    return { current: 0, best: 0, playedToday: false, atRisk: false };
  }
  const playedToday = last.day === today;
  const atRisk = last.day === addDays(today, -1) && last.status === DAILY_PUZZLE_STATUS.SOLVED;
  return { current: playedToday || atRisk ? last.streak : 0, best: last.best, playedToday, atRisk };
}

/**
 * Every day's streak counted again from the start, for when a guest's days joined an account's (ADR-014). A day
 * still being played has no streak yet.
 *
 * @param {ReadonlyArray<EndedDay>} days  one kind's days, oldest first
 * @returns {StreakAfter[]} one per day, in the same order
 */
export function rebuildStreaks(days) {
  const rebuilt = [];
  let previous = [];
  for (const day of days) {
    if (!isDailyPuzzleEnded(day.status)) {
      rebuilt.push({ streak: 0, best: 0 });
      continue;
    }
    const after = streakAfter({ previous, day: day.day, solved: day.status === DAILY_PUZZLE_STATUS.SOLVED });
    rebuilt.push(after);
    previous = [{ ...day, ...after }];
  }
  return rebuilt;
}
