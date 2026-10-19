import { describe, expect, it } from "vitest";
import { getLeaderboard } from "@classicade/shared";
import {
  gamesWithWinsBoards,
  GUEST_ROW_LIFETIME_MS,
  hasWinsBoard,
  rowEnds,
  storageFor,
  WEEKLY_RETENTION_MS,
  weekOf,
} from "./boards.js";

const NOW = Date.parse("2026-10-16T12:00:00Z");

describe("leaderboard storage", () => {
  it("keeps all-time XP in the XP board", () => {
    expect(storageFor(getLeaderboard("overall"), NOW)).toEqual({ board: "xp", period: "all" });
  });

  it("keeps this week's XP in the XP board under the ISO week, resetting next Monday", () => {
    expect(storageFor(getLeaderboard("weekly"), NOW)).toEqual({
      board: "xp",
      period: "2026-W42",
      resetsAt: Date.parse("2026-10-19T00:00:00Z"),
    });
  });

  it("keeps each game's wins in its own board", () => {
    expect(storageFor(getLeaderboard("tic-tac-toe"), NOW)).toEqual({
      board: "wins:tictactoe",
      period: "all",
    });
  });

  it("keeps weekly entries for 28 days after their week", () => {
    expect(weekOf(NOW)).toEqual({
      period: "2026-W42",
      startsAt: Date.parse("2026-10-12T00:00:00Z"),
      expiresAt: Date.parse("2026-10-19T00:00:00Z") + WEEKLY_RETENTION_MS,
    });
    expect(WEEKLY_RETENTION_MS).toBe(28 * 24 * 60 * 60 * 1000);
  });

  it("has a wins board for every catalog game and no other", () => {
    expect(gamesWithWinsBoards()).toEqual(["rps", "tictactoe", "chess"]);
    expect(hasWinsBoard("chess")).toBe(true);
    expect(hasWinsBoard("race")).toBe(false);
  });
});

describe("when rows end (ADR-060)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_ENDS = Date.parse("2026-10-19T00:00:00Z");

  it("keeps a guest's rows 30 days after what put them there", () => {
    expect(GUEST_ROW_LIFETIME_MS).toBe(30 * DAY_MS);
    expect(rowEnds({ isGuest: true, at: NOW })).toEqual({ allTime: NOW + 30 * DAY_MS, week: NOW + 30 * DAY_MS });
  });

  it("never keeps a guest's weekly row past the week's own retention", () => {
    const lastMinute = WEEK_ENDS - 60_000;

    expect(rowEnds({ isGuest: true, at: lastMinute }).week).toBe(WEEK_ENDS + WEEKLY_RETENTION_MS);
    expect(rowEnds({ isGuest: true, at: lastMinute }).allTime).toBe(lastMinute + GUEST_ROW_LIFETIME_MS);
  });

  it("keeps an account's all time rows for ever and its weekly rows 28 days after the week", () => {
    expect(rowEnds({ isGuest: false, at: NOW })).toEqual({ week: WEEK_ENDS + WEEKLY_RETENTION_MS });
  });
});
