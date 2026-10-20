import { describe, expect, it } from "vitest";
import { assertChessPuzzle, chessPuzzlePosition, chessPuzzleSteps, judgeChessMove } from "@classicade/games";
import { loadChessPuzzles } from "./puzzleCatalog.js";

const WEEKS = Array.from({ length: 58 }, (_, index) => index + 1);
const toMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

describe("the daily chess puzzle set", () => {
  const puzzles = loadChessPuzzles();
  const weekOf = (week) => puzzles.slice((week - 1) * 7, week * 7);

  it("holds 406 puzzles, 58 weeks of seven, each with a different id", () => {
    expect(puzzles).toHaveLength(406);
    expect(new Set(puzzles.map(({ id }) => id)).size).toBe(406);
  });

  // Every move of every puzzle goes through chess.js, which finds each move among all the legal ones and writes
  // its SAN. For the whole set in one test that was over 6,000 moves: half a second on a laptop, past the 5 s
  // test limit on a CI runner shared with the other coverage workers. One test per week of seven keeps each
  // test small, and every puzzle is still checked (CC-309).
  it.each(WEEKS)("is valid in every field and every move in week %i", (week) => {
    weekOf(week).forEach((puzzle) => expect(() => assertChessPuzzle(puzzle)).not.toThrow());
  });

  it("gets harder from Monday to Sunday in every week", () => {
    for (const week of WEEKS) {
      const ratings = weekOf(week).map(({ rating }) => rating);
      expect(ratings).toEqual([...ratings].sort((a, b) => a - b));
    }
  });

  it.each(WEEKS)("is solved by playing each solution through the referee in week %i", (week) => {
    for (const puzzle of weekOf(week)) {
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
