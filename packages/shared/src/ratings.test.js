import { describe, expect, it } from "vitest";
import { CHESS_RATING_START } from "./index.js";

describe("chess rating start", () => {
  it("is Glickman's default for an unrated player, and cannot be changed", () => {
    expect(CHESS_RATING_START).toEqual({ rating: 1500, deviation: 350, volatility: 0.06 });
    expect(Object.isFrozen(CHESS_RATING_START)).toBe(true);
  });
});
