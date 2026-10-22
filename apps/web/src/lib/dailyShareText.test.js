import { describe, expect, it } from "vitest";
import { dailyPuzzleText, gridSquares } from "./shareText.js";

const solved = (fields = {}) => ({
  kind: "chess",
  number: 12,
  status: "solved",
  grid: ["firstTry", "afterMistakes", "firstTry"],
  hintsTaken: 0,
  streak: 5,
  ...fields,
});

describe("the daily puzzle share (CC-144): a grid that gives nothing away, Hinglish then English", () => {
  it("draws one square per move: found first time, after a mistake, where it ended, not reached", () => {
    expect(gridSquares(["firstTry", "afterMistakes", "failed", "notReached"])).toBe("🟩🟨🟥⬛");
  });

  it("tells a solved puzzle with its number, the grid and the streak", () => {
    expect(dailyPuzzleText(solved())).toBe(
      "🧩 ClassiCade Daily chess puzzle #12\n🟩🟨🟩 🔥5\nAaj ka chess puzzle solve kar liya! Tum karke dikhao:\nI solved today's chess puzzle on ClassiCade. Can you?",
    );
  });

  it("counts the hints taken and leaves out a streak of 0", () => {
    expect(dailyPuzzleText(solved({ hintsTaken: 2, streak: 0 })).split("\n")[1]).toBe("🟩🟨🟩 💡2");
  });

  it("tells a failed puzzle as a challenge", () => {
    const text = dailyPuzzleText(solved({ status: "failed", grid: ["firstTry", "failed"], streak: 0 }));

    expect(text).toBe(
      "🧩 ClassiCade Daily chess puzzle #12\n🟩🟥\nAaj ka chess puzzle mushkil tha. Tum solve karke dikhao:\nToday's chess puzzle on ClassiCade beat me. Can you solve it?",
    );
  });

  it("names no player, no move and no square", () => {
    const text = dailyPuzzleText(solved());

    expect(text).not.toMatch(/[a-h][1-8]|Guest|Riya/);
  });

  it("has no words for a puzzle still being played or an unknown kind", () => {
    expect(() => dailyPuzzleText(solved({ status: "playing" }))).toThrow(/playing/);
    expect(() => dailyPuzzleText(solved({ kind: "sudoku" }))).toThrow(/sudoku/);
  });

  // "tum", never "aap": the one shared test in src/copy.hinglish.test.js reads these lines (CC-351).
});
