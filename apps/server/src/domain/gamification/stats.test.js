import { describe, expect, it } from "vitest";
import { GAME_IDS } from "@classicade/shared";
import { applyMatchToStats, emptyStats } from "./stats.js";

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
