import { describe, expect, it } from "vitest";
import { chessEngine } from "./chess/chessEngine.js";
import { replayGame } from "./replay.js";
import { rpsEngine } from "./rps/rpsEngine.js";
import { tictactoeEngine } from "./tictactoe/tictactoeEngine.js";

const T0 = 1_700_000_000_000;
const players = ["alice", "bob"];

describe("replayGame", () => {
  it("reproduces a Rock Paper Scissors match exactly", () => {
    const log = [
      { kind: "move", playerId: "alice", move: { choice: "rock" }, at: T0 },
      { kind: "move", playerId: "bob", move: { choice: "scissors" }, at: T0 + 1 },
    ];

    const state = replayGame(rpsEngine, { players, options: { bestOf: 1 }, seed: 1, log });

    expect(rpsEngine.getOutcome(state)).toEqual({
      status: "finished",
      result: "win",
      winners: ["alice"],
      reason: "best-of-1",
    });
  });

  it("reproduces a seeded Tic-Tac-Toe game (seed 42: bob starts)", () => {
    const log = [0, 3, 1, 4, 2].map((cell, i) => ({
      kind: "move",
      playerId: i % 2 === 0 ? "bob" : "alice",
      move: { cell },
      at: T0 + i,
    }));

    const state = replayGame(tictactoeEngine, { players, options: {}, seed: 42, log });

    expect(tictactoeEngine.getOutcome(state).winners).toEqual(["bob"]);
  });

  it("reproduces timed events: a chess flag that fell while nobody moved", () => {
    const log = [
      { kind: "move", playerId: "bob", move: { type: "move", from: "e2", to: "e4" }, at: T0 },
      { kind: "expire", at: T0 + 60_000 },
    ];

    const state = replayGame(chessEngine, { players, options: { timeControl: "bullet-1+0" }, seed: 42, log });

    expect(chessEngine.getOutcome(state)).toEqual({
      status: "finished",
      result: "win",
      winners: ["bob"],
      reason: "timeout",
    });
  });

  it("treats a forfeit as a no-op on the board", () => {
    const log = [{ kind: "forfeit", playerId: "alice", at: T0 }];

    const state = replayGame(tictactoeEngine, { players, options: {}, seed: 42, log });

    expect(state.board.every((cell) => cell === "")).toBe(true);
  });

  it("refuses a tampered log with an illegal move", () => {
    const log = [{ kind: "move", playerId: "alice", move: { cell: 0 }, at: T0 }]; // bob starts with seed 42

    expect(() => replayGame(tictactoeEngine, { players, options: {}, seed: 42, log })).toThrow(
      /not a legal move \(NOT_YOUR_TURN/,
    );
  });

  it("refuses unknown entries and expiries for engines without time hooks", () => {
    expect(() =>
      replayGame(rpsEngine, { players, options: { bestOf: 1 }, seed: 1, log: [{ kind: "undo", at: T0 }] }),
    ).toThrow(/unknown kind "undo"/);
    expect(() =>
      replayGame(rpsEngine, { players, options: { bestOf: 1 }, seed: 1, log: [{ kind: "expire", at: T0 }] }),
    ).toThrow(/has no time hooks/);
  });
});
