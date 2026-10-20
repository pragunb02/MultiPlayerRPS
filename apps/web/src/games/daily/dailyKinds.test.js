import { describe, expect, it } from "vitest";
import { DAILY_PUZZLES } from "@classicade/shared";
import { DAILY_KINDS } from "./dailyKinds.js";

const puzzle = (fields = {}) => ({
  steps: 2,
  maxMistakes: 3,
  mistakes: 0,
  position: { player: "w" },
  ...fields,
});
const { announce, task } = DAILY_KINDS.chess;

describe("the daily puzzle kinds in the web app (CC-144)", () => {
  it("has a board for every kind the catalogue lists", () => {
    expect(Object.keys(DAILY_KINDS)).toEqual(DAILY_PUZZLES.map(({ id }) => id));
  });

  it("says what to find, one move or several", () => {
    expect(task(puzzle())).toBe("White to move. Find 2 moves.");
    expect(task(puzzle({ steps: 1, position: { player: "b" } }))).toBe("Black to move. Find 1 move.");
  });

  it("reads out each answer to a chess move", () => {
    const played = { san: "Qh7+" };

    expect(announce({ outcome: "correct", played, reply: { san: "Kf8" }, puzzle: puzzle() })).toBe(
      "Qh7+ is correct. Black played Kf8. Find the next move.",
    );
    expect(announce({ outcome: "solved", played, puzzle: puzzle() })).toBe("Qh7+. Solved!");
    expect(announce({ outcome: "wrong", played, puzzle: puzzle({ mistakes: 2 }) })).toBe(
      "Qh7+ is not the move. 1 try left.",
    );
    expect(announce({ outcome: "failed", played, puzzle: puzzle({ mistakes: 3 }) })).toBe(
      "Qh7+ is not the move. No tries left. The solution is below.",
    );
  });
});
