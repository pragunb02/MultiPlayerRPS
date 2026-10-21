import { describe, expect, it } from "vitest";
import { UTC_CALENDAR, zoneCalendar } from "../playerDays/zoneCalendar.js";
import { dailyStreakView, nextDailyStreak, nextWinStreak, readDailyStreak } from "./streaks.js";

const ms = (iso) => Date.parse(iso);

describe("win streak", () => {
  const streak = (current, best) => ({ current, best });

  it.each([
    ["win", streak(0, 0), streak(1, 1)],
    ["win", streak(2, 5), streak(3, 5)],
    ["win", streak(5, 5), streak(6, 6)],
    ["draw", streak(2, 4), streak(2, 4)],
    ["loss", streak(3, 4), streak(0, 4)],
    ["forfeit", streak(3, 3), streak(0, 3)],
  ])("%s: %o → %o", (result, before, after) => {
    expect(nextWinStreak(before, result)).toEqual(after);
  });
});

describe("daily play streak", () => {
  const daily = (current, best, lastDay) => ({ current, best, lastDay });

  it.each([
    ["first ever match", daily(0, 0, ""), "win", "2026-10-16", daily(1, 1, "2026-10-16")],
    ["second match the same day", daily(1, 1, "2026-10-16"), "loss", "2026-10-16", daily(1, 1, "2026-10-16")],
    ["the next day", daily(2, 2, "2026-10-15"), "draw", "2026-10-16", daily(3, 3, "2026-10-16")],
    ["across a month end", daily(1, 4, "2026-09-30"), "win", "2026-10-01", daily(2, 4, "2026-10-01")],
    ["after a gap", daily(5, 5, "2026-10-13"), "win", "2026-10-16", daily(1, 5, "2026-10-16")],
    ["your own forfeit", daily(2, 2, "2026-10-15"), "forfeit", "2026-10-16", daily(2, 2, "2026-10-15")],
    ["a late match from before", daily(2, 2, "2026-10-16"), "win", "2026-10-14", daily(2, 2, "2026-10-16")],
  ])("%s", (_case, before, result, day, after) => {
    expect(nextDailyStreak(before, { result, day })).toEqual(after);
  });

  it.each([
    ["played today", "2026-10-16", { current: 4, playedToday: true, atRisk: false }],
    ["played yesterday: at risk", "2026-10-15", { current: 4, playedToday: false, atRisk: true }],
    ["last played before yesterday: broken", "2026-10-14", { current: 0, playedToday: false, atRisk: false }],
    ["never played", "", { current: 0, playedToday: false, atRisk: false }],
  ])("reads as %s", (_case, lastDay, expected) => {
    const view = dailyStreakView({ current: 4, best: 6, lastDay }, ms("2026-10-16T08:00:00Z"));

    expect(view).toEqual({ best: 6, lastDay, ...expected });
  });

  it("turns at risk exactly at UTC midnight", () => {
    const streak = { current: 2, best: 2, lastDay: "2026-10-16" };

    expect(dailyStreakView(streak, ms("2026-10-16T23:59:59.999Z")).playedToday).toBe(true);
    expect(dailyStreakView(streak, ms("2026-10-17T00:00:00.000Z")).atRisk).toBe(true);
  });
});

describe("daily play streak on local days (CC-146)", () => {
  const india = zoneCalendar(undefined);
  const newYork = zoneCalendar({
    zone: "America/New_York",
    previousZone: "UTC",
    changedAt: 0,
    effectiveAt: 0,
    floorDay: "1970-01-01",
  });

  it("reads an old UTC streak without breaking it", () => {
    // Stored before the switch: the last match was on the UTC day 20 October.
    const old = { current: 5, best: 5, lastDay: "2026-10-20" };
    // In India it is now 10:00 on the 22nd. The UTC 20th ran until 05:29 on the 21st there, so it is at risk, not 0.
    expect(dailyStreakView(old, ms("2026-10-22T04:30:00Z"), { calendar: india })).toMatchObject({
      current: 5,
      lastDay: "2026-10-21",
      atRisk: true,
    });
    // In New York it is 22:00 on the 21st: the UTC 20th ended at 20:00 on the 20th there.
    expect(dailyStreakView(old, ms("2026-10-22T02:00:00Z"), { calendar: newYork })).toMatchObject({
      current: 5,
      lastDay: "2026-10-20",
      atRisk: true,
    });
  });

  it("never reads an old key as later than today", () => {
    const old = { current: 2, best: 2, lastDay: "2026-10-21" };
    // The UTC 21st overlaps the 22nd in India, but that has not come yet.
    expect(readDailyStreak(old, { calendar: india, today: "2026-10-21" })).toEqual({ ...old, days: "local" });
  });

  it("marks local keys as UTC when read back on UTC days, keeping them", () => {
    const local = { current: 2, best: 2, lastDay: "2026-10-21", days: "local", lastAt: 1 };
    expect(readDailyStreak(local, { calendar: UTC_CALENDAR, today: "2026-10-21" })).toEqual({
      ...local,
      days: "utc",
    });
  });

  it("counts a match at 23:30 in New York on the New York day", () => {
    const stored = { current: 1, best: 1, lastDay: "2026-10-20", days: "local", lastAt: 0 };
    const at = ms("2026-10-22T03:30:00Z"); // 23:30 on the 21st in New York, already the 22nd in UTC
    expect(nextDailyStreak(stored, { result: "win", day: newYork.dayOf(at), at })).toEqual({
      ...stored,
      current: 2,
      best: 2,
      lastDay: "2026-10-21",
      lastAt: at,
    });
  });
});
