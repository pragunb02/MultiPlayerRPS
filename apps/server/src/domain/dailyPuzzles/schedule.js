import { addDays, dayOf, daysBetween, startOfDay } from "../../utils/indiaTime.js";

/**
 * Puzzle #1 was the puzzle of this day. It is a Monday, because each kind's set is ordered so the rating rises from
 * Monday to Sunday (ADR-061). Moving it to another Monday changes the number players see, not the weekday rhythm.
 */
export const FIRST_DAY = "2026-10-19";

/**
 * The days the daily puzzles follow: India days for now (ADR-034). CC-146 gives each player their own day by
 * handing the component another calendar with the same two functions.
 *
 * @typedef {{ dayOf: (ms: number) => string, nextDayAt: (ms: number) => number }} PuzzleCalendar
 * @type {Readonly<PuzzleCalendar>}
 */
export const INDIA_CALENDAR = Object.freeze({
  dayOf,
  nextDayAt: (ms) => startOfDay(addDays(dayOf(ms), 1)),
});

/**
 * Which puzzle of a set a day gets. Days follow the set in order, so no puzzle comes back before the whole set has
 * been played, and then it starts again from the top.
 *
 * @param {{ day: string, count: number }} input  count: puzzles in the set
 * @returns {{ number: number, index: number }}  number: the puzzle's number, #1 on FIRST_DAY
 * @throws {RangeError} for a day before FIRST_DAY, or an empty set
 */
export function scheduleOn({ day, count }) {
  const daysSince = daysBetween(FIRST_DAY, day);
  if (daysSince < 0 || count < 1) {
    throw new RangeError(`No daily puzzle for ${day} in a set of ${count}`);
  }
  return { number: daysSince + 1, index: daysSince % count };
}
