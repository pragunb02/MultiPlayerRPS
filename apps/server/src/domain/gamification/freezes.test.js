import { describe, expect, it } from "vitest";
import { zoneCalendar } from "../playerDays/zoneCalendar.js";
import { dailyStreakView, freezeCoveredOn, MAX_FREEZES, nextDailyStreak } from "./streaks.js";

// Streak freezes (CC-145, ADR-077.7). Days are fixed keys and moments: nothing reads the real clock (CC-325).
// 2026-10-19 is a Monday.
const ON = { freezes: true };
const fresh = { current: 0, best: 0, lastDay: "", days: "local" };
const india = zoneCalendar(undefined);
/** Noon in India on a day. */
const noon = (day) => Date.parse(`${day}T06:30:00.000Z`);

/** Plays one counted match on each day given, in order, with freezes on. */
const play = (streak, ...days) =>
  days.reduce((s, day) => nextDailyStreak(s, { result: "win", day, at: noon(day), ...ON }), streak);

describe("streak freezes (CC-145)", () => {
  it("earns one freeze with the first counted match of a week, at most 2", () => {
    const monday = play(fresh, "2026-10-19");
    expect(monday.freezes).toBe(1);
    expect(play(monday, "2026-10-20", "2026-10-25").freezes).toBe(1); // the rest of that week earns nothing more
    const nextWeek = play(monday, "2026-10-26");
    expect(nextWeek.freezes).toBe(2);
    expect(play(nextWeek, "2026-11-02").freezes).toBe(MAX_FREEZES); // a third is not kept
  });

  it("counts no forfeit towards a freeze", () => {
    const after = nextDailyStreak(fresh, {
      result: "forfeit",
      day: "2026-10-19",
      at: noon("2026-10-19"),
      ...ON,
    });
    expect(after).toBe(fresh);
  });

  it("covers a missed day with a freeze automatically", () => {
    const before = play(fresh, "2026-10-19", "2026-10-20"); // 1 freeze, a 2-day streak
    const after = play(before, "2026-10-22"); // Wednesday the 21st missed
    expect(after).toMatchObject({ current: 3, best: 3, freezes: 0, frozenDays: ["2026-10-21"] });
    expect(freezeCoveredOn(after, "2026-10-22")).toBe(true);
  });

  it("spends nothing when the freezes cannot cover every missed day", () => {
    const before = play(fresh, "2026-10-19", "2026-10-20");
    const after = play(before, "2026-10-23"); // two days missed, one freeze
    expect(after).toMatchObject({ current: 1, best: 2, freezes: 1, frozenDays: [] });
    expect(freezeCoveredOn(after, "2026-10-23")).toBe(false);
  });

  it("covers two missed days with two freezes", () => {
    const before = play(fresh, "2026-10-19", "2026-10-26", "2026-10-27"); // 2 freezes; the gap before the 26th broke
    const after = play(before, "2026-10-30");
    expect(after).toMatchObject({ current: 3, freezes: 0, frozenDays: ["2026-10-28", "2026-10-29"] });
  });

  it("earns a freeze back with two matches the day after", () => {
    const covered = play(play(fresh, "2026-10-19", "2026-10-20"), "2026-10-22");
    expect(covered).toMatchObject({ freezes: 0, earnBack: { day: "2026-10-22", matches: 1 } });
    const second = play(covered, "2026-10-22");
    expect(second).toMatchObject({ freezes: 1, earnBack: null });
    expect(play(second, "2026-10-22").freezes).toBe(1); // once per cover
    // Only that day: a second match the day after it gives nothing back.
    expect(play(covered, "2026-10-23", "2026-10-23").freezes).toBe(0);
  });

  it("keeps the longest streak and counts only days played", () => {
    let streak = play(fresh, "2026-10-19", "2026-10-20", "2026-10-21"); // 3 days
    streak = play(streak, "2026-10-23"); // one frozen day: 4, not 5
    expect(streak).toMatchObject({ current: 4, best: 4 });
    streak = play(streak, "2026-11-01"); // a long gap breaks it
    expect(streak).toMatchObject({ current: 1, best: 4 });
  });

  it("shows a covered streak on read without spending anything", () => {
    const stored = Object.freeze(play(fresh, "2026-10-19", "2026-10-20"));
    const view = dailyStreakView(stored, noon("2026-10-22"), { calendar: india, freezes: true });
    expect(view).toMatchObject({
      current: 2,
      playedToday: false,
      atRisk: true, // the freeze is in use: a second missed day would end it
      freezes: { held: 0, max: 2, covering: 1, earnBackLeft: 2 },
      nextMilestone: 3,
    });
    expect(stored.freezes).toBe(1);
    // Two days missed with one freeze: broken.
    expect(dailyStreakView(stored, noon("2026-10-23"), { calendar: india, freezes: true })).toMatchObject({
      current: 0,
      freezes: { held: 1, covering: 0 },
    });
  });

  it("names no milestone past the last one", () => {
    const long = { ...play(fresh, "2026-10-19"), current: 400, best: 400 };
    expect(
      dailyStreakView(long, noon("2026-10-19"), { calendar: india, freezes: true }).nextMilestone,
    ).toBeNull();
  });

  it("is not at risk while a freeze is spare", () => {
    const stored = play(fresh, "2026-10-19", "2026-10-26", "2026-10-27"); // 2 freezes
    const view = dailyStreakView(stored, noon("2026-10-28"), { calendar: india, freezes: true });
    expect(view).toMatchObject({
      current: 2,
      atRisk: false,
      freezes: { held: 2, covering: 0, earnBackLeft: 0 },
    });
  });

  it("reads an old streak with no freeze fields", () => {
    const old = { current: 4, best: 6, lastDay: "2026-10-20" }; // as stored before CC-145, on UTC days
    const view = dailyStreakView(old, noon("2026-10-21"), { calendar: india, freezes: true });
    expect(view).toMatchObject({ current: 4, freezes: { held: 0, covering: 0 } });
    expect(play(old, "2026-10-21")).toMatchObject({ current: 5, freezes: 1, frozenDays: [] });
  });

  it("neither earns nor spends with the flag off, and keeps what is stored", () => {
    const stored = { ...play(fresh, "2026-10-19", "2026-10-20"), freezes: 1 };
    const off = nextDailyStreak(stored, { result: "win", day: "2026-10-22", at: noon("2026-10-22") });
    expect(off).toMatchObject({ current: 1, freezes: 1, frozenDays: [] });
    expect(dailyStreakView(stored, noon("2026-10-22"), { calendar: india })).not.toHaveProperty("freezes");
  });

  it("treats days covered before as played through in a rebuild", () => {
    const rebuilt = ["2026-10-19", "2026-10-20", "2026-10-22"].reduce(
      (s, day) => nextDailyStreak(s, { result: "win", day, covered: ["2026-10-21"] }),
      { current: 0, best: 0, lastDay: "" },
    );
    expect(rebuilt).toMatchObject({ current: 3, best: 3 });
  });
});
