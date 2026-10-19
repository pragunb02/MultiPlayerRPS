import { describe, expect, it } from "vitest";
import {
  assertChessPuzzle,
  chessHint,
  chessPuzzlePosition,
  chessPuzzleSteps,
  chessSolution,
  judgeChessMove,
} from "./chessPuzzle.js";

/** Lichess puzzle 0000D (CC0): White plays Qd6, then Black wins the queen with Rd8 and Bxd8. */
const TWO_STEPS = Object.freeze({
  id: "0000D",
  fen: "5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27",
  moves: Object.freeze(["d3d6", "f8d8", "d6d8", "f6d8"]),
  rating: 1529,
  themes: Object.freeze(["advantage", "endgame", "short"]),
});

/** Lichess puzzle 001KR (CC0): mate in one, where Rf8 and Rd8 both mate. */
const MATE_IN_ONE = Object.freeze({
  id: "001KR",
  fen: "6Qk/p1p3pp/4N3/1p6/2q1r1n1/2B5/PP4PP/3R1R1K b - - 0 28",
  moves: Object.freeze(["h8g8", "f1f8"]),
  rating: 563,
  themes: Object.freeze(["mate", "mateIn1", "oneMove", "middlegame"]),
});

/** A position where White's pawn promotes: the solution is e7e8q. */
const PROMOTION = Object.freeze({
  id: "promo",
  fen: "7k/4P3/8/8/8/8/7r/K7 b - - 0 1",
  moves: Object.freeze(["h2h3", "e7e8q"]),
  rating: 900,
  themes: Object.freeze(["promotion"]),
});

describe("the chess puzzle referee", () => {
  it("counts the moves the player has to find", () => {
    expect(chessPuzzleSteps(TWO_STEPS)).toBe(2);
    expect(chessPuzzleSteps(MATE_IN_ONE)).toBe(1);
  });

  it("starts after the opponent's first move, with the player to move", () => {
    const position = chessPuzzlePosition({ puzzle: TWO_STEPS, found: [] });

    expect(position).toEqual({
      fen: "5rk1/1p3ppp/pq1Q1b2/8/8/1P3N2/P4PPP/3R2K1 b - - 3 27",
      toMove: "b",
      player: "b",
      lastMove: { from: "d3", to: "d6", san: "Qd6" },
      line: [],
    });
  });

  it("accepts the expected move and answers with the opponent's reply", () => {
    const judged = judgeChessMove({ puzzle: TWO_STEPS, found: [], move: { from: "f8", to: "d8" } });

    expect(judged).toEqual({
      legal: true,
      correct: true,
      solved: false,
      played: { uci: "f8d8", san: "Rd8" },
      reply: { uci: "d6d8", san: "Qxd8+", from: "d6", to: "d8" },
    });
  });

  it("refuses a legal move that is not the solution, without moving the board on", () => {
    const judged = judgeChessMove({ puzzle: TWO_STEPS, found: [], move: { from: "g8", to: "h8" } });

    expect(judged).toEqual({ legal: true, correct: false, played: { uci: "g8h8", san: "Kh8" } });
  });

  it("calls an impossible move illegal", () => {
    expect(judgeChessMove({ puzzle: TWO_STEPS, found: [], move: { from: "f8", to: "f1" } })).toEqual({
      legal: false,
    });
    expect(judgeChessMove({ puzzle: TWO_STEPS, found: [], move: { from: "e4", to: "e5" } })).toEqual({
      legal: false,
    });
  });

  it("solves the puzzle with the last move and has no reply then", () => {
    const judged = judgeChessMove({ puzzle: TWO_STEPS, found: ["f8d8"], move: { from: "f6", to: "d8" } });

    expect(judged).toEqual({
      legal: true,
      correct: true,
      solved: true,
      played: { uci: "f6d8", san: "Bxd8" },
    });
  });

  it("shows the line played so far, with the opponent's replies", () => {
    const position = chessPuzzlePosition({ puzzle: TWO_STEPS, found: ["f8d8"] });

    expect(position.line).toEqual(["Rd8", "Qxd8+"]);
    expect(position.lastMove).toEqual({ from: "d6", to: "d8", san: "Qxd8+" });
    expect(position.toMove).toBe("b");
  });

  it("accepts any checkmate, as Lichess does", () => {
    const judged = judgeChessMove({ puzzle: MATE_IN_ONE, found: [], move: { from: "d1", to: "d8" } });

    expect(judged).toMatchObject({ correct: true, solved: true, played: { uci: "d1d8", san: "Rd8#" } });
  });

  it("shows an alternative mate as the move played", () => {
    const position = chessPuzzlePosition({ puzzle: MATE_IN_ONE, found: ["d1d8"] });

    expect(position.line).toEqual(["Rd8#"]);
  });

  it("needs the promotion piece the solution names", () => {
    expect(
      judgeChessMove({ puzzle: PROMOTION, found: [], move: { from: "e7", to: "e8", promotion: "q" } }),
    ).toMatchObject({ correct: true, solved: true });
    expect(
      judgeChessMove({ puzzle: PROMOTION, found: [], move: { from: "e7", to: "e8", promotion: "n" } }),
    ).toMatchObject({ legal: true, correct: false });
    expect(judgeChessMove({ puzzle: PROMOTION, found: [], move: { from: "e7", to: "e8" } })).toEqual({
      legal: false,
    });
  });

  it("gives the idea first and then the piece to move", () => {
    expect(chessHint({ puzzle: MATE_IN_ONE, found: [], level: 1 })).toBe("Look for checkmate in one move.");
    expect(chessHint({ puzzle: MATE_IN_ONE, found: [], level: 2 })).toBe("Move your rook on f1.");
    expect(chessHint({ puzzle: TWO_STEPS, found: ["f8d8"], level: 2 })).toBe("Move your bishop on f6.");
  });

  it("names the main tactic before the goal", () => {
    const fork = { ...TWO_STEPS, themes: ["advantage", "fork", "middlegame"] };
    const plain = { ...TWO_STEPS, themes: ["middlegame"] };
    const equal = { ...TWO_STEPS, themes: ["equality", "endgame"] };

    expect(chessHint({ puzzle: fork, found: [], level: 1 })).toBe("Look for a fork.");
    expect(chessHint({ puzzle: TWO_STEPS, found: [], level: 1 })).toBe("Look for a way to win material.");
    expect(chessHint({ puzzle: equal, found: [], level: 1 })).toBe("Find the move that saves the game.");
    expect(chessHint({ puzzle: plain, found: [], level: 1 })).toBe("Look for the strongest move.");
  });

  it("refuses a hint level it does not have", () => {
    expect(() => chessHint({ puzzle: TWO_STEPS, found: [], level: 3 })).toThrow(RangeError);
  });

  it("writes the whole solution in SAN, the opponent's replies included", () => {
    expect(chessSolution(TWO_STEPS)).toEqual(["Rd8", "Qxd8+", "Bxd8"]);
  });

  it("accepts a puzzle whose moves are all legal", () => {
    expect(() => assertChessPuzzle(TWO_STEPS)).not.toThrow();
  });

  it("rejects a puzzle with an illegal move, a wrong number of moves or a bad field", () => {
    expect(() => assertChessPuzzle({ ...TWO_STEPS, moves: ["d3d6", "f8f1"] })).toThrow(/0000D/);
    expect(() => assertChessPuzzle({ ...TWO_STEPS, moves: ["d3d6", "f8d8", "d6d8"] })).toThrow(/0000D/);
    expect(() => assertChessPuzzle({ ...TWO_STEPS, fen: "not a fen" })).toThrow(/0000D/);
    expect(() => assertChessPuzzle({ ...TWO_STEPS, rating: "high" })).toThrow(/0000D/);
    expect(() => assertChessPuzzle({ ...TWO_STEPS, themes: "fork" })).toThrow(/0000D/);
    expect(() => assertChessPuzzle({ ...TWO_STEPS, id: "" })).toThrow(/id/);
  });
});
