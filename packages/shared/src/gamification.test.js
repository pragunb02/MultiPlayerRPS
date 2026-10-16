import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_METRICS,
  ACHIEVEMENT_TIERS,
  ACHIEVEMENTS,
  DAILY_SWEEP_BONUS_XP,
  GAMES,
  QUEST_COUNTS,
  QUEST_SLOTS,
  QUESTS,
  winsOfMetric,
  xpForLevel,
} from "./index.js";

const isKnownMetric = (metric) =>
  Object.values(ACHIEVEMENT_METRICS).includes(metric) ||
  GAMES.some((game) => metric === winsOfMetric(game.id));

describe("ACHIEVEMENTS", () => {
  it("lists the 15 launch achievements with unique ids, in display order", () => {
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual([
      "first-match",
      "first-win",
      "wins-10",
      "wins-50",
      "matches-100",
      "streak-3",
      "streak-5",
      "daily-3",
      "daily-7",
      "all-games",
      "rps-10",
      "tictactoe-10",
      "chess-checkmate",
      "level-10",
      "quests-10",
    ]);
  });

  it("is immutable, entry by entry", () => {
    expect(Object.isFrozen(ACHIEVEMENTS)).toBe(true);
    expect(ACHIEVEMENTS.every(Object.isFrozen)).toBe(true);
  });

  it.each(ACHIEVEMENTS)("$id has a known tier, a known metric and a positive target", (achievement) => {
    expect(Object.values(ACHIEVEMENT_TIERS)).toContain(achievement.tier);
    expect(isKnownMetric(achievement.metric)).toBe(true);
    expect(achievement.target).toBeGreaterThan(0);
    expect(achievement.name).not.toBe("");
    expect(achievement.icon).not.toBe("");
  });

  it("asks for a win of every game in the catalog, and level 10 in XP", () => {
    expect(ACHIEVEMENTS.find((a) => a.id === "all-games").target).toBe(GAMES.length);
    expect(ACHIEVEMENTS.find((a) => a.id === "level-10").target).toBe(xpForLevel(10));
  });
});

describe("QUESTS", () => {
  it("has unique ids, and every slot can be filled", () => {
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(QUESTS.length);
    for (const slot of Object.values(QUEST_SLOTS)) {
      expect(QUESTS.some((q) => q.slot === slot)).toBe(true);
    }
  });

  it.each(QUESTS)("$id counts something known, for any game or a catalog game", (quest) => {
    expect(Object.values(QUEST_COUNTS)).toContain(quest.counts);
    expect(quest.gameId === null || GAMES.some((game) => game.id === quest.gameId)).toBe(true);
    expect(quest.target).toBeGreaterThan(0);
    expect(quest.bonusXp).toBeGreaterThanOrEqual(20);
    expect(quest.bonusXp).toBeLessThanOrEqual(50);
  });

  it("caps quest XP at 150 a day (richest quest of each slot plus the sweep)", () => {
    const richest = Object.values(QUEST_SLOTS).map((slot) =>
      Math.max(...QUESTS.filter((q) => q.slot === slot).map((q) => q.bonusXp)),
    );

    expect(richest.reduce((sum, xp) => sum + xp, 0) + DAILY_SWEEP_BONUS_XP).toBe(150);
  });
});
