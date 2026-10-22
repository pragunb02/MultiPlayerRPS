import { describe, expect, it } from "vitest";
import { GAME_IDS } from "@classicade/shared";
import { zoneCalendar } from "../playerDays/zoneCalendar.js";
import { applyMatchToStats, emptyStats } from "./stats.js";
import { dailyStreakView } from "./streaks.js";

const ms = (iso) => Date.parse(iso);

describe("player stats", () => {
  const T = ms("2026-10-16T12:00:00Z");

  it("counts matches and wins per game, checkmate wins and both streaks", () => {
    const stats = [
      { gameId: GAME_IDS.CHESS, result: "win", reason: "checkmate", endedAt: T },
      { gameId: GAME_IDS.CHESS, result: "win", reason: "resignation", endedAt: T + 1 },
      { gameId: GAME_IDS.RPS, result: "loss", reason: "best-of-1", endedAt: T + 2 },
      { gameId: GAME_IDS.RPS, result: "draw", reason: "best-of-1", endedAt: T + 86_400_000 },
    ].reduce(applyMatchToStats, emptyStats("guest_a"));

    expect(stats).toEqual({
      playerId: "guest_a",
      winsByGame: { chess: 2 },
      matchesByGame: { chess: 2, rps: 2 },
      checkmateWins: 1,
      questsCompleted: 0,
      winStreak: { current: 0, best: 2 },
      dailyStreak: { current: 2, best: 2, lastDay: "2026-10-17" },
      mergedFrom: [],
    });
  });

  it("does not count a checkmate the player lost", () => {
    const stats = applyMatchToStats(emptyStats("guest_b"), {
      gameId: GAME_IDS.CHESS,
      result: "loss",
      reason: "checkmate",
      endedAt: T,
    });

    expect(stats.checkmateWins).toBe(0);
  });
});

describe("player stats on local days (CC-146)", () => {
  it("never moves an old UTC streak back for a late match", () => {
    const india = zoneCalendar(undefined);
    // Stored before the switch: last played on the UTC day 21 October, a 5-day streak.
    const old = { ...emptyStats("guest_a"), dailyStreak: { current: 5, best: 5, lastDay: "2026-10-21" } };
    const now = ms("2026-10-22T04:30:00Z"); // 10:00 on the 22nd in India
    // A match from the 19th arrives late.
    const stats = applyMatchToStats(old, {
      gameId: GAME_IDS.RPS,
      result: "win",
      reason: "best-of-1",
      endedAt: ms("2026-10-19T06:30:00Z"),
      calendar: india,
      now,
    });

    expect(stats.dailyStreak).toMatchObject({ current: 5, lastDay: "2026-10-22" });
    expect(dailyStreakView(stats.dailyStreak, now, { calendar: india }).current).toBe(5);
  });
});
