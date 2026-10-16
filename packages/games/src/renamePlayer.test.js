import { describe, expect, it } from "vitest";
import { renamePlayer } from "./renamePlayer.js";

describe("renamePlayer", () => {
  it("replaces the id as a value and as a key, at any depth, without touching the input", () => {
    const state = Object.freeze({
      players: ["guest_a", "guest_b"],
      marks: { guest_a: "X", guest_b: "O" },
      turn: "guest_a",
      log: [{ playerId: "guest_a", move: { cell: 4 } }],
      board: ["", "X", ""],
    });

    expect(renamePlayer(state, "guest_a", "user_1")).toEqual({
      players: ["user_1", "guest_b"],
      marks: { user_1: "X", guest_b: "O" },
      turn: "user_1",
      log: [{ playerId: "user_1", move: { cell: 4 } }],
      board: ["", "X", ""],
    });
    expect(state.turn).toBe("guest_a");
  });

  it("leaves other values alone, including ones that merely contain the id", () => {
    expect(renamePlayer({ note: "guest_a won", n: 1, ok: true, none: null }, "guest_a", "user_1")).toEqual({
      note: "guest_a won",
      n: 1,
      ok: true,
      none: null,
    });
  });
});
