import { describe, expect, it } from "vitest";
import {
  DAILY_PUZZLE_ENDED,
  DAILY_PUZZLE_KINDS,
  DAILY_PUZZLES,
  getDailyPuzzle,
  getGame,
  isDailyPuzzleEnded,
} from "./index.js";

describe("the daily puzzles catalogue", () => {
  it("has one entry per kind, each for a game in the catalogue", () => {
    expect(DAILY_PUZZLES.map(({ id }) => id)).toEqual(Object.values(DAILY_PUZZLE_KINDS));
    DAILY_PUZZLES.forEach(({ gameId }) => expect(getGame(gameId)).toBeDefined());
  });

  it("calls a day ended once it is solved or failed, never before", () => {
    expect(DAILY_PUZZLE_ENDED).toEqual(["solved", "failed"]);
    expect(["new", "playing", "solved", "failed"].map(isDailyPuzzleEnded)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("finds a kind by its id and nothing for an unknown one", () => {
    expect(getDailyPuzzle("chess")).toMatchObject({
      name: "Daily chess puzzle",
      maxMistakes: 3,
      maxHints: 2,
    });
    expect(getDailyPuzzle("sudoku")).toBeUndefined();
  });
});
