import { describe, expect, it } from "vitest";
import { tictactoeSounds } from "./tictactoeAlerts.js";

const ttt = (board, winningLine = []) => ({ game: { view: { board, winningLine } } });
const EMPTY = ["", "", "", "", "", "", "", "", ""];

describe("Tic-Tac-Toe sounds (CC-103)", () => {
  it("pops when a mark lands", () => {
    expect(tictactoeSounds(ttt(EMPTY), ttt(["X", ...EMPTY.slice(1)]))).toEqual(["place"]);
  });

  it("adds a flourish when the mark completes a line", () => {
    const before = ttt(["X", "X", "", "O", "O", "", "", "", ""]);
    const after = ttt(["X", "X", "X", "O", "O", "", "", "", ""], [0, 1, 2]);

    expect(tictactoeSounds(before, after)).toEqual(["place", "line"]);
  });

  it("is quiet when nothing was placed, and never repeats the flourish", () => {
    const won = ttt(["X", "X", "X", "O", "O", "", "", "", ""], [0, 1, 2]);

    expect(tictactoeSounds(ttt(EMPTY), ttt(EMPTY))).toEqual([]);
    expect(tictactoeSounds(won, won)).toEqual([]);
  });

  it("plays the flourish alone when a line shows up without a new mark", () => {
    const board = ["X", "X", "X", "O", "O", "", "", "", ""];

    expect(tictactoeSounds(ttt(board), ttt(board, [0, 1, 2]))).toEqual(["line"]);
  });
});
