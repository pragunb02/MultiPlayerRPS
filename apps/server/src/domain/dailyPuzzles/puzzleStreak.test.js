import { describe, expect, it } from "vitest";
import { rebuildStreaks, streakAfter, streakView } from "./puzzleStreak.js";

const ended = (day, status, streak, best) => ({ day, status, streak, best });

describe("a daily puzzle streak", () => {
  it("starts at 1 with the first solved day", () => {
    expect(streakAfter({ previous: [], day: "2026-10-20", solved: true })).toEqual({ streak: 1, best: 1 });
  });

  it("adds one for a day solved after a solved yesterday", () => {
    const previous = [ended("2026-10-19", "solved", 4, 6)];

    expect(streakAfter({ previous, day: "2026-10-20", solved: true })).toEqual({ streak: 5, best: 6 });
  });

  it("starts again at 1 after a gap, keeping the best", () => {
    const previous = [ended("2026-10-17", "solved", 6, 6)];

    expect(streakAfter({ previous, day: "2026-10-20", solved: true })).toEqual({ streak: 1, best: 6 });
  });

  it("starts again at 1 after a failed yesterday", () => {
    const previous = [ended("2026-10-19", "failed", 0, 3)];

    expect(streakAfter({ previous, day: "2026-10-20", solved: true })).toEqual({ streak: 1, best: 3 });
  });

  it("goes to 0 on a failed day", () => {
    const previous = [ended("2026-10-19", "solved", 4, 4)];

    expect(streakAfter({ previous, day: "2026-10-20", solved: false })).toEqual({ streak: 0, best: 4 });
  });

  it("is a new best once it passes the old one", () => {
    const previous = [ended("2026-10-19", "solved", 4, 4)];

    expect(streakAfter({ previous, day: "2026-10-20", solved: true })).toEqual({ streak: 5, best: 5 });
  });
});

describe("the streak a player sees", () => {
  const today = "2026-10-20";

  it("is empty before the first day", () => {
    expect(streakView({ latest: [], today })).toEqual({
      current: 0,
      best: 0,
      playedToday: false,
      atRisk: false,
    });
  });

  it("counts today once today's puzzle has ended", () => {
    expect(streakView({ latest: [ended(today, "solved", 3, 5)], today })).toEqual({
      current: 3,
      best: 5,
      playedToday: true,
      atRisk: false,
    });
  });

  it("is at risk when it was last extended yesterday", () => {
    expect(streakView({ latest: [ended("2026-10-19", "solved", 3, 5)], today })).toEqual({
      current: 3,
      best: 5,
      playedToday: false,
      atRisk: true,
    });
  });

  it("is broken after a failed yesterday or a missed day", () => {
    expect(streakView({ latest: [ended("2026-10-19", "failed", 0, 5)], today })).toMatchObject({
      current: 0,
      best: 5,
      atRisk: false,
    });
    expect(streakView({ latest: [ended("2026-10-18", "solved", 3, 5)], today })).toMatchObject({
      current: 0,
      best: 5,
      atRisk: false,
    });
  });
});

describe("rebuilding streaks after days moved", () => {
  it("counts every ended day again in order and leaves days still being played at 0", () => {
    const days = [
      ended("2026-10-15", "solved", 9, 9),
      ended("2026-10-16", "solved", 1, 1),
      ended("2026-10-17", "playing", 0, 0),
      ended("2026-10-18", "solved", 1, 1),
      ended("2026-10-19", "solved", 1, 9),
      ended("2026-10-20", "failed", 0, 0),
    ];

    expect(rebuildStreaks(days)).toEqual([
      { streak: 1, best: 1 },
      { streak: 2, best: 2 },
      { streak: 0, best: 0 },
      { streak: 1, best: 2 },
      { streak: 2, best: 2 },
      { streak: 0, best: 2 },
    ]);
  });
});
