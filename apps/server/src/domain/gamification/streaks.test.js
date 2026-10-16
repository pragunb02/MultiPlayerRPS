import { describe, expect, it } from "vitest";
import { dailyStreakView, nextDailyStreak, nextWinStreak } from "./streaks.js";

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
