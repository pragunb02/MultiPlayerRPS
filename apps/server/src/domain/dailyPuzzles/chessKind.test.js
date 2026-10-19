import { describe, expect, it } from "vitest";
import { createChessKind } from "./chessKind.js";

const PUZZLE = Object.freeze({
  id: "0000D",
  fen: "5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27",
  moves: Object.freeze(["d3d6", "f8d8", "d6d8", "f6d8"]),
  rating: 1529,
  themes: Object.freeze(["advantage", "endgame", "short"]),
});
const OTHER = Object.freeze({ ...PUZZLE, id: "0000E" });

describe("the chess puzzle kind", () => {
  const kind = createChessKind({ puzzles: [PUZZLE, OTHER] });

  it("has the catalogue's limits and the set's size", () => {
    expect(kind).toMatchObject({ id: "chess", maxMistakes: 3, maxHints: 2, count: 2 });
  });

  it("finds a puzzle by its place in the set and by its id", () => {
    expect(kind.puzzleAt(1)).toBe(OTHER);
    expect(kind.puzzleById("0000D")).toBe(PUZZLE);
  });

  it("refuses an id that is not in the set", () => {
    expect(() => kind.puzzleById("nope")).toThrow(RangeError);
  });

  it("judges, hints and solves with the chess referee", () => {
    expect(kind.steps(PUZZLE)).toBe(2);
    expect(kind.rating(PUZZLE)).toBe(1529);
    expect(kind.position({ puzzle: PUZZLE, found: [] }).toMove).toBe("b");
    expect(kind.judge({ puzzle: PUZZLE, found: [], move: { from: "f8", to: "d8" } })).toMatchObject({
      correct: true,
      reply: { san: "Qxd8+" },
    });
    expect(kind.hint({ puzzle: PUZZLE, found: [], level: 2 })).toBe("Move your rook on f8.");
    expect(kind.solution(PUZZLE)).toEqual(["Rd8", "Qxd8+", "Bxd8"]);
    expect(kind.sourceUrl(PUZZLE)).toBe("https://lichess.org/training/0000D");
  });
});
