import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "@classicade/shared";
import { achievementStanding, evaluateAchievements, metricValue } from "./evaluateAchievements.js";
import { emptyStats } from "./stats.js";

describe("evaluateAchievements", () => {
  const progress = (overrides = {}) => ({ xp: 0, matchesPlayed: 0, wins: 0, ...overrides });
  const stats = (overrides = {}) => ({ ...emptyStats("guest_a"), ...overrides });

  // Each achievement, one step below its threshold and exactly at it.
  const AT_THRESHOLD = {
    "first-match": (n) => [stats(), progress({ matchesPlayed: n })],
    "first-win": (n) => [stats(), progress({ wins: n })],
    "wins-10": (n) => [stats(), progress({ wins: n })],
    "wins-50": (n) => [stats(), progress({ wins: n })],
    "matches-100": (n) => [stats(), progress({ matchesPlayed: n })],
    "streak-3": (n) => [stats({ winStreak: { current: 0, best: n } }), progress()],
    "streak-5": (n) => [stats({ winStreak: { current: 0, best: n } }), progress()],
    "daily-3": (n) => [stats({ dailyStreak: { current: 0, best: n, lastDay: "" } }), progress()],
    "daily-7": (n) => [stats({ dailyStreak: { current: 0, best: n, lastDay: "" } }), progress()],
    "all-games": (n) => [
      stats({ winsByGame: Object.fromEntries(["rps", "tictactoe", "chess"].slice(0, n).map((g) => [g, 1])) }),
      progress(),
    ],
    "rps-10": (n) => [stats({ winsByGame: { rps: n } }), progress()],
    "tictactoe-10": (n) => [stats({ winsByGame: { tictactoe: n } }), progress()],
    "chess-checkmate": (n) => [stats({ checkmateWins: n }), progress()],
    "level-10": (n) => [stats(), progress({ xp: n })],
    "quests-10": (n) => [stats({ questsCompleted: n }), progress()],
  };

  it("has a threshold case for every catalog entry", () => {
    expect(Object.keys(AT_THRESHOLD)).toEqual(ACHIEVEMENTS.map((a) => a.id));
  });

  it.each(ACHIEVEMENTS.map((a) => [a.id, a.target]))("%s unlocks at %i, not one below", (id, target) => {
    expect(evaluateAchievements(...AT_THRESHOLD[id](target - 1))).not.toContain(id);
    expect(evaluateAchievements(...AT_THRESHOLD[id](target))).toContain(id);
  });

  it("unlocks nothing for a new player", () => {
    expect(evaluateAchievements(stats(), progress())).toEqual([]);
  });

  it("reports progress capped at the target", () => {
    const standing = achievementStanding(stats(), progress({ wins: 12, matchesPlayed: 12 }));
    const of = (id) => standing.find((s) => s.achievement.id === id);

    expect(of("wins-10")).toEqual(expect.objectContaining({ current: 10, earned: true }));
    expect(of("wins-50")).toEqual(expect.objectContaining({ current: 12, earned: false }));
  });

  it("reads wins of a game that has none yet as 0, and refuses an unknown metric", () => {
    expect(metricValue("winsByGame.ludo", { stats: stats(), progress: progress() })).toBe(0);
    expect(() => metricValue("vibes", { stats: stats(), progress: progress() })).toThrow(RangeError);
  });
});
