import { describe, expect, it } from "vitest";
import { CHESS_TIME_CONTROLS } from "./chess.js";
import { QUICK_MATCH_OUTCOMES, QUICK_MATCH_RULES } from "./quickMatch.js";

describe("quick match words and rules (CC-051)", () => {
  it("ends a search one of three ways", () => {
    expect(Object.values(QUICK_MATCH_OUTCOMES)).toEqual(["person", "character", "cancelled"]);
  });

  it("looks for at most 4 s (ADR-029) and plays chess at a real time control, 3+2 (ADR-051.6)", () => {
    expect(QUICK_MATCH_RULES.searchMs).toBe(4_000);
    expect(Object.keys(CHESS_TIME_CONTROLS)).toContain(QUICK_MATCH_RULES.chessTimeControl);
  });
});
