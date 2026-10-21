import { describe, expect, it } from "vitest";
import { MOVE_REJECTIONS } from "@classicade/shared";
import { createSeededRng } from "../rng.js";
import { describeEngineContract } from "../testing/engineContract.js";
import { tictactoeEngine, WINNING_LINES } from "./tictactoeEngine.js";

const A = "alice";
const B = "bob";
const CTX = { now: 0 };

// Seed 42 makes the second player (bob) start, playing X.
describeEngineContract(
  tictactoeEngine,
  {
    players: [A, B],
    options: {},
    invalidOptions: [{ size: 4 }, null, "x", []],
    seed: 42,
    playthrough: [
      { player: B, move: { cell: 0 } },
      { player: A, move: { cell: 3 } },
      { player: B, move: { cell: 1 } },
      { player: A, move: { cell: 4 } },
      { player: B, move: { cell: 2 } },
    ],
    expectedOutcome: { status: "finished", result: "win", winners: [B], reason: "three-in-a-row" },
    rejectedMoves: [
      { player: A, move: { cell: 0 }, reason: MOVE_REJECTIONS.NOT_YOUR_TURN },
      { player: B, move: { cell: 9 }, reason: MOVE_REJECTIONS.INVALID_MOVE },
      { player: B, move: { cell: -1 }, reason: MOVE_REJECTIONS.INVALID_MOVE },
      { player: B, move: { cell: 1.5 }, reason: MOVE_REJECTIONS.INVALID_MOVE },
      { player: B, move: { cell: "4" }, reason: MOVE_REJECTIONS.INVALID_MOVE },
    ],
  },
  { describe, it },
);

/** A new game (seed 42: bob plays X and starts), then the given cells played alternately. */
function play(cells, seed = 42) {
  let state = tictactoeEngine.init({ players: [A, B], options: {}, rng: createSeededRng(seed) });
  for (const cell of cells) {
    const player = state.turn;
    const validated = tictactoeEngine.validateMove(state, player, { cell }, CTX);
    if (!validated.ok) {
      throw new Error(`move ${cell} by ${player} rejected: ${validated.reason}`);
    }
    state = tictactoeEngine.applyMove(state, player, validated.value, CTX);
  }
  return state;
}

describe("tictactoeEngine rules", () => {
  it("lets the seeded starter play X", () => {
    const state = play([]);

    expect(state.marks).toEqual({ [B]: "X", [A]: "O" });
    expect(state.turn).toBe(B);
  });

  it("picks the starter fairly across seeds", () => {
    const starters = Array.from({ length: 1_000 }, (_, seed) => play([], seed).turn);
    const bobStarts = starters.filter((p) => p === B).length;

    expect(bobStarts).toBeGreaterThan(400);
    expect(bobStarts).toBeLessThan(600);
  });

  it("gives X and the first move to a named starter, whatever the seed says (CC-091)", () => {
    const state = tictactoeEngine.init({
      players: [A, B],
      options: {},
      rng: createSeededRng(42),
      starter: A,
    });

    expect(state.marks).toEqual({ [A]: "X", [B]: "O" });
    expect(state.turn).toBe(A);
    expect(tictactoeEngine.starterOf(state)).toBe(A);
  });

  it("names the seeded starter as the one who started, also after moves (CC-091)", () => {
    expect(tictactoeEngine.starterOf(play([]))).toBe(B);
    expect(tictactoeEngine.starterOf(play([0, 3]))).toBe(B);
  });

  it("starts exactly as before when no starter is named (CC-091)", () => {
    const state = play([]);

    expect(state).toEqual({
      players: [A, B],
      marks: { [B]: "X", [A]: "O" },
      board: Array(9).fill(""),
      turn: B,
      winner: "",
      winningLine: [],
    });
  });

  it("refuses a starter who is not one of the players (CC-091)", () => {
    expect(() =>
      tictactoeEngine.init({ players: [A, B], options: {}, rng: createSeededRng(42), starter: "carol" }),
    ).toThrow(TypeError);
  });

  // X (bob) completes `line`. O plays the two `blockers`, which never form a line or block X.
  it.each([
    [
      [0, 1, 2],
      [3, 4],
    ],
    [
      [3, 4, 5],
      [0, 1],
    ],
    [
      [6, 7, 8],
      [0, 1],
    ],
    [
      [0, 3, 6],
      [1, 4],
    ],
    [
      [1, 4, 7],
      [0, 2],
    ],
    [
      [2, 5, 8],
      [0, 4],
    ],
    [
      [0, 4, 8],
      [1, 2],
    ],
    [
      [2, 4, 6],
      [0, 1],
    ],
  ])("detects three in a row on %j", (line, blockers) => {
    const state = play([line[0], blockers[0], line[1], blockers[1], line[2]]);

    expect(state.winner).toBe(B);
    expect(state.winningLine).toEqual(line);
    expect(tictactoeEngine.getOutcome(state).result).toBe("win");
  });

  it("covers every winning line", () => {
    expect(WINNING_LINES).toHaveLength(8);
  });

  it("declares a draw when the board fills with no line", () => {
    //  X O X
    //  X O O
    //  O X X
    const state = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);

    expect(tictactoeEngine.getOutcome(state)).toEqual({
      status: "finished",
      result: "draw",
      winners: [],
      reason: "board-full",
    });
    expect(tictactoeEngine.activePlayers(state)).toEqual([]);
  });

  it("gives exactly one result when the last move completes two lines and fills the board (regression: BUG-04)", () => {
    //  X X X      move 9 (cell 2) completes the top row and the 2-4-6 diagonal
    //  O X O
    //  X O O
    const state = play([0, 3, 1, 5, 4, 8, 6, 7, 2]);

    expect(state.board.every((cell) => cell !== "")).toBe(true);
    expect(tictactoeEngine.getOutcome(state)).toEqual({
      status: "finished",
      result: "win",
      winners: [B],
      reason: "three-in-a-row",
    });
  });

  it("refuses an occupied cell", () => {
    const state = play([4]);

    expect(tictactoeEngine.validateMove(state, A, { cell: 4 }, CTX)).toEqual(
      expect.objectContaining({ ok: false, reason: MOVE_REJECTIONS.ILLEGAL_MOVE }),
    );
  });

  it("alternates turns", () => {
    expect(play([4]).turn).toBe(A);
    expect(play([4, 0]).turn).toBe(B);
  });

  it("refuses options (there are none)", () => {
    expect(tictactoeEngine.validateOptions({}).ok).toBe(true);
    expect(tictactoeEngine.validateOptions({ firstPlayer: A }).ok).toBe(false);
  });

  it("shows everyone the same board, marks, turn and winning line", () => {
    const state = play([0, 3, 1, 4, 2]);

    for (const viewer of [A, B, "spectator"]) {
      expect(tictactoeEngine.viewFor(state, viewer)).toEqual({
        board: ["X", "X", "X", "O", "O", "", "", "", ""],
        marks: { [B]: "X", [A]: "O" },
        turn: "",
        winningLine: [0, 1, 2],
      });
    }
  });
});
