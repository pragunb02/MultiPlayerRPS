import { describe, expect, it } from "vitest";
import { assertChessPuzzle, chessPuzzlePosition, chessPuzzleSteps, judgeChessMove } from "@classicade/games";
import { loadChessPuzzles } from "./puzzleCatalog.js";

const toMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

describe("the daily chess puzzle set", () => {
  const puzzles = loadChessPuzzles();

  it("holds 406 puzzles, 58 weeks of seven, each with a different id", () => {
    expect(puzzles).toHaveLength(406);
    expect(new Set(puzzles.map(({ id }) => id)).size).toBe(406);
  });

  it("is valid in every field and every move", () => {
    puzzles.forEach((puzzle) => expect(() => assertChessPuzzle(puzzle)).not.toThrow());
  });

  it("gets harder from Monday to Sunday in every week", () => {
    for (let week = 0; week < 58; week += 1) {
      const ratings = puzzles.slice(week * 7, week * 7 + 7).map(({ rating }) => rating);
      expect(ratings).toEqual([...ratings].sort((a, b) => a - b));
    }
  });

  it("is solved by playing each solution through the referee", () => {
    for (const puzzle of puzzles) {
      const found = [];
      for (let step = 0; step < chessPuzzleSteps(puzzle); step += 1) {
        const judged = judgeChessMove({ puzzle, found, move: toMove(puzzle.moves[2 * step + 1]) });
        expect(judged.correct).toBe(true);
        found.push(judged.played.uci);
        if (judged.solved) break;
      }
      expect(chessPuzzlePosition({ puzzle, found }).line.length).toBeGreaterThan(0);
    }
  });

  it("refuses a file that is not a CC0 puzzle set", () => {
    expect(() =>
      loadChessPuzzles({ file: new URL("../testing/puzzles/notCc0.json", import.meta.url) }),
    ).toThrow(/not a CC0 puzzle set/);
  });
});
