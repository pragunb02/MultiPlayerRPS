import { describe, expect, it } from "vitest";
import { DAILY_PUZZLE_KINDS, DAILY_PUZZLES, getDailyPuzzle, getGame } from "./index.js";

describe("the daily puzzles catalogue", () => {
  it("has one entry per kind, each for a game in the catalogue", () => {
    expect(DAILY_PUZZLES.map(({ id }) => id)).toEqual(Object.values(DAILY_PUZZLE_KINDS));
    DAILY_PUZZLES.forEach(({ gameId }) => expect(getGame(gameId)).toBeDefined());
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
