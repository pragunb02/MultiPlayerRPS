import { addDays, utcDay } from "./calendar.js";

/**
 * Streak rules (ADR-013), as pure functions of the previous streak and one match result.
 *
 * @typedef {{ current: number, best: number }} WinStreak
 * @typedef {{ current: number, best: number, lastDay: string }} DailyStreak   lastDay "" = never played
 * @typedef {"win" | "draw" | "loss" | "forfeit"} MatchResult
 */

/**
 * Win streak, across all games in the order matches ended: a win extends it, a loss or forfeit ends it, a draw
 * changes nothing.
 *
 * @param {Readonly<WinStreak>} streak
 * @param {MatchResult} result
 * @returns {Readonly<WinStreak>}
 */
export function nextWinStreak(streak, result) {
  if (result === "draw") {
    return streak;
  }
  if (result === "win") {
    const current = streak.current + 1;
    return Object.freeze({ current, best: Math.max(streak.best, current) });
  }
  return Object.freeze({ current: 0, best: streak.best });
}

/**
 * Daily play streak, in UTC days. Any finished match counts except your own forfeit. A second match on the same
 * day changes nothing; playing the day after extends it; a gap starts again at 1. A match from before the last
 * counted day (it arrived late) changes nothing either.
 *
 * @param {Readonly<DailyStreak>} streak
 * @param {{ result: MatchResult, day: string }} match
 * @returns {Readonly<DailyStreak>}
 */
export function nextDailyStreak(streak, { result, day }) {
  if (result === "forfeit" || (streak.lastDay !== "" && day <= streak.lastDay)) {
    return streak;
  }
  const current = streak.lastDay === addDays(day, -1) ? streak.current + 1 : 1;
  return Object.freeze({ current, best: Math.max(streak.best, current), lastDay: day });
}

/**
 * The daily streak as the player sees it at `now`: a streak whose last day was before yesterday is broken (0);
 * one last extended yesterday is at risk until the player plays today.
 *
 * @param {Readonly<DailyStreak>} streak
 * @param {number} now
 * @returns {Readonly<DailyStreak & { playedToday: boolean, atRisk: boolean }>}
 */
export function dailyStreakView(streak, now) {
  const today = utcDay(now);
  const yesterday = addDays(today, -1);
  return Object.freeze({
    current: streak.lastDay < yesterday ? 0 : streak.current,
    best: streak.best,
    lastDay: streak.lastDay,
    playedToday: streak.lastDay === today,
    atRisk: streak.lastDay === yesterday,
  });
}
