import { describe, expect, it } from "vitest";
import { levelForXp, MAX_LEVEL, XP_AWARDS, xpForLevel } from "./index.js";

describe("progression rules", () => {
  it.each([
    [1, 0],
    [2, 50],
    [3, 150],
    [4, 300],
    [5, 500],
  ])("level %i starts at %i XP", (level, xp) => {
    expect(xpForLevel(level)).toBe(xp);
  });

  it.each([
    [0, 1],
    [49, 1],
    [50, 2],
    [149, 2],
    [150, 3],
    [10_000_000, MAX_LEVEL],
  ])("%i XP is level %i", (xp, level) => {
    expect(levelForXp(xp)).toBe(level);
  });

  it.each([0, -1, 1.5, Number.NaN, "2", MAX_LEVEL + 1])("refuses level %s", (level) => {
    expect(() => xpForLevel(level)).toThrow(RangeError);
  });

  it.each([-1, 0.5, Number.NaN, "50", undefined])("refuses %s XP", (xp) => {
    expect(() => levelForXp(xp)).toThrow(RangeError);
  });

  it("is consistent in both directions for every level", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      expect(levelForXp(xpForLevel(level))).toBe(level);
    }
  });

  it.each([0, 1.5, MAX_LEVEL + 1])("rejects level %s", (level) => {
    expect(() => xpForLevel(level)).toThrow(RangeError);
  });

  it.each([-1, 2.5, Number.NaN])("rejects xp %s", (xp) => {
    expect(() => levelForXp(xp)).toThrow(RangeError);
  });

  it("rewards playing, and gives nothing for forfeiting", () => {
    expect(XP_AWARDS.win).toBeGreaterThan(XP_AWARDS.draw);
    expect(XP_AWARDS.draw).toBeGreaterThan(XP_AWARDS.loss);
    expect(XP_AWARDS.loss).toBeGreaterThan(XP_AWARDS.forfeit);
    expect(XP_AWARDS.forfeit).toBe(0);
  });
});
