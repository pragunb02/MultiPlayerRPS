import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEADERBOARD_ID,
  GAMES,
  getLeaderboard,
  LEADERBOARD_MAX_ENTRIES,
  LEADERBOARD_UNLISTED,
  LEADERBOARDS,
} from "./index.js";

describe("why a viewer has no rank", () => {
  it("is only ever that they have no score yet: guests are ranked too (ADR-060)", () => {
    expect(LEADERBOARD_UNLISTED).toEqual({ UNRANKED: "unranked" });
  });
});

describe("leaderboard catalog", () => {
  it("has overall XP, this week, and one wins board per game", () => {
    expect(LEADERBOARDS.map((board) => board.id)).toEqual([
      "overall",
      "weekly",
      ...GAMES.map((game) => game.slug),
    ]);
    expect(getLeaderboard("weekly")).toEqual({
      id: "weekly",
      name: "This week",
      metric: "xp",
      period: "week",
    });
    expect(getLeaderboard("chess")).toEqual({
      id: "chess",
      name: "Chess",
      metric: "wins",
      period: "all",
      gameId: "chess",
    });
  });

  it("gives every board a unique, URL-safe id", () => {
    const ids = LEADERBOARDS.map((board) => board.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/));
  });

  it("starts at the overall board and lists at most 50 entries", () => {
    expect(DEFAULT_LEADERBOARD_ID).toBe("overall");
    expect(LEADERBOARD_MAX_ENTRIES).toBe(50);
  });

  it("knows no other boards", () => {
    expect(getLeaderboard("unknown")).toBeUndefined();
  });

  it("is immutable", () => {
    expect(Object.isFrozen(LEADERBOARDS)).toBe(true);
    LEADERBOARDS.forEach((board) => expect(Object.isFrozen(board)).toBe(true));
  });
});
