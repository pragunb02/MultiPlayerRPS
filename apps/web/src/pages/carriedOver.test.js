import { describe, expect, it } from "vitest";
import { carriedOverMessage } from "./carriedOver.js";

describe("carriedOverMessage", () => {
  it.each([
    [undefined, ""],
    [{ xp: 0, matchesPlayed: 0, matches: 0 }, ""],
    [{ xp: 30, matchesPlayed: 1, matches: 1 }, "Welcome! We moved 30 XP and 1 match from your guest games."],
    [
      { xp: 70, matchesPlayed: 3, matches: 3 },
      "Welcome! We moved 70 XP and 3 matches from your guest games.",
    ],
  ])("describes %o", (carriedOver, message) => {
    expect(carriedOverMessage(carriedOver)).toBe(message);
  });
});
