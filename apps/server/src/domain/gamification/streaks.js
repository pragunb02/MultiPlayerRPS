import { addDays, daysBetween, weekOf } from "../../utils/indiaTime.js";
import { UTC_CALENDAR } from "../playerDays/zoneCalendar.js";

/**
 * Streak rules (ADR-013, ADR-077), as pure functions of the previous streak and one match result. Day keys are the
 * player's own days (CC-146): the caller works the day out with the player's calendar. The date maths below only
 * counts calendar days between keys, so it is the same in every zone.
 *
 * @typedef {{ current: number, best: number }} WinStreak
 * @typedef {{ day: string, matches: number }} EarnBack   counted matches so far on the day a freeze was spent
 * @typedef {Object} DailyStreak
 * @property {number} current
 * @property {number} best
 * @property {string} lastDay          "" = never played
 * @property {number} [lastAt]         the moment of the last counted match (written with local days)
 * @property {"utc" | "local"} [days]  which calendar `lastDay` belongs to. Missing: UTC, as stored before CC-146
 * @property {number} [freezes]        freezes held, 0 to MAX_FREEZES (CC-145)
 * @property {string} [freezeWeek]     the Monday of the week whose freeze was earned, "" = none yet
 * @property {string[]} [frozenDays]   the latest days a freeze covered, oldest first
 * @property {EarnBack | null} [earnBack]
 * @typedef {"win" | "draw" | "loss" | "forfeit"} MatchResult
 */

/** A player holds at most this many freezes (ADR-026.5). */
export const MAX_FREEZES = 2;
/** Counted matches on the day after a cover that give the freeze back. */
export const EARN_BACK_MATCHES = 2;
/** How many covered days are remembered, for a rebuild after a guest signs in. */
export const FROZEN_DAYS_KEPT = 60;
/** The days the card names as the next milestone. Only words: no reward (CC-145). */
export const STREAK_MILESTONES = Object.freeze([3, 7, 30, 100, 365]);

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** The freeze fields of a streak, with the defaults of a document stored before CC-145. */
const freezeFields = (streak) => ({
  freezes: streak.freezes ?? 0,
  freezeWeek: streak.freezeWeek ?? "",
  frozenDays: streak.frozenDays ?? [],
  earnBack: streak.earnBack ?? null,
});

/**
 * The stored streak read for a calendar (migrate on read, ADR-077.5). Keys stored on UTC days and read on local
 * days become the latest local day their UTC day overlaps, never after `today`, so the switch never breaks a
 * streak. Read back on UTC days, local keys are kept as they are and marked UTC.
 *
 * @param {Readonly<DailyStreak>} streak
 * @param {{ calendar: Readonly<import("../playerDays/zoneCalendar.js").PlayerCalendar>, today: string }} input
 * @returns {Readonly<DailyStreak>}
 */
export function readDailyStreak(streak, { calendar, today }) {
  const local = calendar.kind === "local";
  if (!local) {
    return streak.days === "local" ? Object.freeze({ ...streak, days: "utc" }) : streak;
  }
  if (streak.days === "local") {
    return streak;
  }
  if (streak.lastDay === "") {
    return Object.freeze({ ...streak, days: "local" });
  }
  const lastOfUtcDay = Date.parse(`${streak.lastDay}T00:00:00.000Z`) + DAY_MS - 1;
  const overlapped = calendar.dayOf(lastOfUtcDay);
  return Object.freeze({ ...streak, days: "local", lastDay: overlapped < today ? overlapped : today });
}

/** The days strictly between two days. */
const daysBetweenOf = (from, to) =>
  Array.from({ length: Math.max(0, daysBetween(from, to) - 1) }, (_, index) => addDays(from, index + 1));

/** The week's freeze, with the first counted match of a week. A freeze earned while holding the most is not kept. */
function earnWeekly(streak, day) {
  const week = weekOf(day);
  if (streak.freezeWeek === week) {
    return streak;
  }
  return { ...streak, freezeWeek: week, freezes: Math.min(MAX_FREEZES, streak.freezes + 1) };
}

/** A further counted match on the day after a cover: the second one gives the freeze back, once. */
function countEarnBack(streak, day) {
  if (streak.earnBack === null || streak.earnBack.day !== day) {
    return streak;
  }
  const matches = streak.earnBack.matches + 1;
  if (matches < EARN_BACK_MATCHES) {
    return { ...streak, earnBack: { day, matches } };
  }
  return { ...streak, earnBack: null, freezes: Math.min(MAX_FREEZES, streak.freezes + 1) };
}

/**
 * Daily play streak. Any finished match counts except your own forfeit. A second match on the same day changes
 * nothing; playing the day after extends it; a gap starts again at 1. A match from before the last counted day (it
 * arrived late) changes nothing either.
 *
 * With `freezes` (CC-145, ADR-077.7): the first counted match of a week earns a freeze (at most 2); missed days are
 * covered one freeze each, only when the freezes cover all of them, and a covered day adds nothing; a second
 * counted match on the day after a cover gives one freeze back. `covered` are days a freeze covered before, which a
 * rebuild from the history treats as played through without spending anything.
 *
 * @param {Readonly<DailyStreak>} streak
 * @param {{ result: MatchResult, day: string, at?: number, freezes?: boolean, covered?: ReadonlyArray<string> }} match
 * @returns {Readonly<DailyStreak>}
 */
export function nextDailyStreak(streak, { result, day, at, freezes = false, covered = [] }) {
  if (result === "forfeit" || (streak.lastDay !== "" && day < streak.lastDay)) {
    return streak;
  }
  const stamp = streak.days === "local" || streak.lastAt !== undefined ? { lastAt: at } : {};
  if (day === streak.lastDay) {
    if (!freezes) {
      return streak;
    }
    return Object.freeze({ ...countEarnBack(earnWeekly({ ...streak, ...freezeFields(streak) }, day), day) });
  }
  const missed = streak.lastDay === "" ? [] : daysBetweenOf(streak.lastDay, day);
  if (!freezes) {
    const carried = missed.length === 0 || missed.every((d) => covered.includes(d));
    const current = streak.lastDay !== "" && carried ? streak.current + 1 : 1;
    return Object.freeze({
      ...streak,
      current,
      best: Math.max(streak.best, current),
      lastDay: day,
      ...stamp,
    });
  }
  const held = freezeFields(streak);
  let next;
  if (streak.lastDay === "") {
    next = { ...held, current: 1 };
  } else if (missed.length === 0 || missed.every((d) => covered.includes(d))) {
    next = { ...held, current: streak.current + 1, earnBack: null };
  } else if (held.freezes >= missed.length) {
    next = {
      ...held,
      current: streak.current + 1,
      freezes: held.freezes - missed.length,
      frozenDays: [...held.frozenDays, ...missed].slice(-FROZEN_DAYS_KEPT),
      earnBack: { day, matches: 1 },
    };
  } else {
    next = { ...held, current: 1, earnBack: null };
  }
  const moved = { ...streak, ...next, best: Math.max(streak.best, next.current), lastDay: day, ...stamp };
  return Object.freeze(earnWeekly(moved, day));
}

/** Whether the match just applied spent a freeze on missed days (the flag's success, ADR-073.6). */
export const freezeCoveredOn = (streak, day) => streak.earnBack?.day === day && streak.earnBack.matches === 1;

/**
 * The daily streak as the player sees it at `now`. Without freezes: a streak whose last day was before yesterday is
 * broken (0); one last extended yesterday is at risk until the player plays today. With freezes, missed days the
 * freezes can cover keep it alive, shown as covering; nothing is spent until the next counted match.
 *
 * @param {Readonly<DailyStreak>} stored
 * @param {number} now
 * @param {{ calendar?: Readonly<import("../playerDays/zoneCalendar.js").PlayerCalendar>, freezes?: boolean, showResetsAt?: boolean }} [options]
 *   `showResetsAt`: add when the player's day ends (local days, CC-146)
 */
export function dailyStreakView(
  stored,
  now,
  { calendar = UTC_CALENDAR, freezes = false, showResetsAt = false } = {},
) {
  const today = calendar.dayOf(now);
  const streak = readDailyStreak(stored, { calendar, today });
  const yesterday = addDays(today, -1);
  const playedToday = streak.lastDay === today;
  const resetsAt = showResetsAt ? { resetsAt: calendar.nextDayAt(now) } : {};
  if (!freezes) {
    return Object.freeze({
      current: streak.lastDay < yesterday ? 0 : streak.current,
      best: streak.best,
      lastDay: streak.lastDay,
      playedToday,
      atRisk: streak.lastDay === yesterday,
      ...resetsAt,
    });
  }
  const held = freezeFields(streak);
  const missed =
    streak.lastDay === "" || streak.lastDay >= today ? 0 : daysBetween(streak.lastDay, today) - 1;
  const alive = streak.lastDay !== "" && missed <= held.freezes;
  const covering = alive ? missed : 0;
  const current = alive ? streak.current : 0;
  const left = held.freezes - covering;
  const pendingEarnBack = held.earnBack?.day === today ? EARN_BACK_MATCHES - held.earnBack.matches : 0;
  return Object.freeze({
    current,
    best: streak.best,
    lastDay: streak.lastDay,
    playedToday,
    atRisk: alive && !playedToday && current > 0 && left === 0,
    ...resetsAt,
    freezes: Object.freeze({
      held: left,
      max: MAX_FREEZES,
      covering,
      earnBackLeft: covering > 0 ? EARN_BACK_MATCHES : pendingEarnBack,
    }),
    nextMilestone: STREAK_MILESTONES.find((days) => days > current) ?? null,
  });
}
