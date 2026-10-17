import { describe, expect, it } from "vitest";
import {
  boardRows,
  buildPgn,
  castlingRook,
  colourName,
  describePieces,
  endReasonText,
  isArrowKey,
  isDarkSquare,
  materialBalance,
  opposite,
  pgnFileName,
  pieceImage,
  positionWithMove,
  replayGame,
  resultToken,
  squareAtPoint,
  squareInDirection,
  squareOffset,
} from "./chessGame.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const RECT = Object.freeze({ left: 100, top: 50, width: 400, height: 400 });

describe("board geometry", () => {
  it("lists the squares top row first, from White's side and from Black's", () => {
    expect(boardRows("w")[0]).toEqual(["a8", "b8", "c8", "d8", "e8", "f8", "g8", "h8"]);
    expect(boardRows("w")[7][0]).toBe("a1");
    expect(boardRows("b")[0]).toEqual(["h1", "g1", "f1", "e1", "d1", "c1", "b1", "a1"]);
    expect(boardRows("b")[7][7]).toBe("a8");
  });

  it("knows which squares are dark", () => {
    expect(isDarkSquare("a1")).toBe(true);
    expect(isDarkSquare("h1")).toBe(false);
    expect(isDarkSquare("e4")).toBe(false);
  });

  it("names colours, flips them and finds piece images", () => {
    expect(colourName("w")).toBe("white");
    expect(colourName("b")).toBe("black");
    expect(opposite("w")).toBe("b");
    expect(opposite("b")).toBe("w");
    expect(pieceImage("b", "n")).toBe("/pieces/bN.png");
  });

  it("only treats the four arrows as board keys", () => {
    expect(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].every(isArrowKey)).toBe(true);
    expect(isArrowKey("Enter")).toBe(false);
    expect(isArrowKey("toString")).toBe(false);
  });

  it.each([
    ["e2", "ArrowUp", "w", "e3"],
    ["e2", "ArrowDown", "w", "e1"],
    ["e2", "ArrowLeft", "w", "d2"],
    ["e2", "ArrowRight", "w", "f2"],
    // Black sits on the other side, so up on screen is down the ranks and right is towards the a-file.
    ["e7", "ArrowUp", "b", "e6"],
    ["e7", "ArrowRight", "b", "d7"],
  ])("moves from %s with %s on %s's board to %s", (from, key, orientation, to) => {
    expect(squareInDirection(from, key, orientation)).toBe(to);
  });

  it.each([
    ["a1", "ArrowLeft"],
    ["h1", "ArrowRight"],
    ["a1", "ArrowDown"],
    ["a8", "ArrowUp"],
  ])("stays on %s at the edge of the board when pressing %s", (square, key) => {
    expect(squareInDirection(square, key, "w")).toBe(square);
  });

  it("finds the square under a point, from either side", () => {
    expect(squareAtPoint({ rect: RECT, x: 101, y: 51, orientation: "w" })).toBe("a8");
    expect(squareAtPoint({ rect: RECT, x: 499, y: 449, orientation: "w" })).toBe("h1");
    expect(squareAtPoint({ rect: RECT, x: 101, y: 51, orientation: "b" })).toBe("h1");
    // e4 from White's side: fifth column, fifth row from the top.
    expect(squareAtPoint({ rect: RECT, x: 100 + 4.5 * 50, y: 50 + 4.5 * 50, orientation: "w" })).toBe("e4");
  });

  it.each([
    ["left of the board", { x: 99, y: 200 }],
    ["right of the board", { x: 500, y: 200 }],
    ["above the board", { x: 200, y: 49 }],
    ["below the board", { x: 200, y: 450 }],
  ])("finds no square for a point %s", (_where, point) => {
    expect(squareAtPoint({ rect: RECT, ...point, orientation: "w" })).toBe("");
  });

  it("finds no square on a board that has no size yet", () => {
    const rect = { left: 0, top: 0, width: 0, height: 0 };

    expect(squareAtPoint({ rect, x: 0, y: 0, orientation: "w" })).toBe("");
  });

  it("measures how far a piece slides on screen, in squares", () => {
    expect(squareOffset({ from: "e2", to: "e4", orientation: "w" })).toEqual({ x: 0, y: 2 });
    expect(squareOffset({ from: "g1", to: "f3", orientation: "w" })).toEqual({ x: 1, y: 2 });
    expect(squareOffset({ from: "e2", to: "e4", orientation: "b" })).toEqual({ x: -0, y: -2 });
  });
});

describe("game history", () => {
  it("replays the moves into every position, starting with the start", () => {
    const { positions, chess } = replayGame(["e4", "e5", "Nf3"]);

    expect(positions).toHaveLength(4);
    expect(positions[0]).toEqual({ fen: START, from: "", to: "", san: "", flags: "" });
    expect(positions[3]).toMatchObject({ from: "g1", to: "f3", san: "Nf3", flags: "n" });
    expect(chess.history()).toEqual(["e4", "e5", "Nf3"]);
  });

  it("stops at a move that does not replay, keeping the history before it", () => {
    const { positions } = replayGame(["e4", "Ke2??", "e5"]);

    expect(positions.map((p) => p.san)).toEqual(["", "e4"]);
  });

  it("shows a move before the server confirms it", () => {
    expect(positionWithMove(START, { from: "e2", to: "e4" })).toMatchObject({
      from: "e2",
      to: "e4",
      san: "e4",
    });
  });

  it("finds the rook's move in a castling move, and nothing in other moves", () => {
    expect(castlingRook({ to: "g1", flags: "k" })).toEqual({ from: "h1", to: "f1" });
    expect(castlingRook({ to: "c8", flags: "q" })).toEqual({ from: "a8", to: "d8" });
    expect(castlingRook({ to: "e4", flags: "b" })).toBeUndefined();
  });
});

describe("material", () => {
  it("is level at the start", () => {
    expect(materialBalance(START)).toEqual({ captured: { w: [], b: [] }, advantage: { w: 0, b: 0 } });
  });

  it("lists what each side took, pawns first, and who is ahead", () => {
    // White has taken a knight and a pawn, Black a pawn.
    const fen = "r1bqkbnr/ppp2ppp/8/3p4/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 4";

    expect(materialBalance(fen)).toEqual({
      captured: { w: ["p", "n"], b: ["p"] },
      advantage: { w: 3, b: 0 },
    });
  });

  it("does not count a promoted pawn as taken, and counts its new piece in the score", () => {
    // White has two queens (one promoted) and seven pawns. Black is missing a rook.
    const fen = "rnbqkbnQ/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR b KQq - 0 1";

    expect(materialBalance(fen)).toEqual({
      captured: { w: ["r"], b: [] },
      advantage: { w: 13, b: 0 },
    });
  });

  it("shows Black's lead as Black's", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1";

    expect(materialBalance(fen).advantage).toEqual({ w: 0, b: 9 });
  });

  it("describes taken pieces in words", () => {
    expect(describePieces(["p", "p", "n"])).toBe("2 pawns, 1 knight");
    expect(describePieces(["q"])).toBe("1 queen");
    expect(describePieces([])).toBe("");
  });
});

describe("result and PGN", () => {
  const colors = { alice: "w", bob: "b" };

  it.each([
    [undefined, "*"],
    [{ status: "ongoing" }, "*"],
    [{ result: "draw", winners: [] }, "1/2-1/2"],
    [{ result: "win", winners: ["alice"] }, "1-0"],
    [{ result: "win", winners: ["bob"] }, "0-1"],
  ])("writes the outcome %j as %s", (outcome, token) => {
    expect(resultToken(outcome, colors)).toBe(token);
  });

  it.each([
    ["checkmate", "Checkmate"],
    ["stalemate", "Stalemate"],
    ["insufficient-material", "Insufficient material"],
    ["threefold-repetition", "Threefold repetition"],
    ["fifty-move-rule", "Fifty-move rule"],
    ["resignation", "Resignation"],
    ["agreement", "Draw by agreement"],
    ["timeout", "Time out"],
    ["timeout-vs-insufficient-material", "Time out with too little material to win"],
    ["forfeit", "Opponent left"],
    ["a-reason-from-a-newer-server", "Game over"],
  ])("says why the game ended (%s)", (reason, text) => {
    expect(endReasonText(reason)).toBe(text);
  });

  const game = (overrides = {}) => ({
    moves: ["f3", "e5", "g4", "Qh4#"],
    white: "Alice",
    black: "Bob",
    result: "0-1",
    reason: "checkmate",
    timeControl: "blitz-3+2",
    date: Date.UTC(2026, 9, 16, 12),
    site: "https://classicade.example",
    ...overrides,
  });

  it("writes a finished game as PGN with its headers", () => {
    const pgn = buildPgn(game());

    expect(pgn).toContain('[Event "ClassiCade casual game"]');
    expect(pgn).toContain('[Site "https://classicade.example"]');
    expect(pgn).toContain('[Date "2026.10.16"]');
    expect(pgn).toContain('[White "Alice"]');
    expect(pgn).toContain('[Black "Bob"]');
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toContain('[TimeControl "180+2"]');
    expect(pgn).toContain('[Termination "Checkmate"]');
    expect(pgn.endsWith("1. f3 e5 2. g4 Qh4# 0-1\n")).toBe(true);
  });

  it("leaves out the termination while the game is on, and marks an unknown time control", () => {
    const pgn = buildPgn(game({ moves: ["e4"], result: "*", reason: "", timeControl: "blitz-99+0" }));

    expect(pgn).not.toContain("Termination");
    expect(pgn).toContain('[TimeControl "-"]');
    expect(pgn.endsWith("1. e4 *\n")).toBe(true);
  });

  it("names the file after the room and the day", () => {
    expect(pgnFileName({ code: "AB2CD3", date: Date.UTC(2026, 0, 5) })).toBe(
      "classicade-AB2CD3-2026-01-05.pgn",
    );
  });
});
