import { describe, expect, it } from "vitest";
import { FEWER_THAN_MIN, marginOfError, peopleCount, plainShare, shareOf } from "./privacy.js";

describe("small group suppression", () => {
  it("shows 0 and 5 or more people, and hides 1 to 4", () => {
    expect([0, 1, 4, 5, 120].map(peopleCount)).toEqual([0, FEWER_THAN_MIN, FEWER_THAN_MIN, 5, 120]);
  });

  it("hides a share of fewer than 5 people, including a share of nobody", () => {
    expect(shareOf({ part: 1, whole: 3 })).toBe(FEWER_THAN_MIN);
    expect(shareOf({ part: 0, whole: 0 })).toBe(FEWER_THAN_MIN);
    expect(shareOf({ part: 2, whole: 6 })).toBe(0.3333);
  });

  it("shows any share of matches, and zero of none", () => {
    expect(plainShare({ part: 1, whole: 3 })).toBe(0.3333);
    expect(plainShare({ part: 0, whole: 0 })).toBe(0);
  });

  it("gives the 95% margin of error of a share", () => {
    expect(marginOfError({ share: 0.25, size: 100 })).toBe(0.0849);
    expect(marginOfError({ share: 0, size: 10 })).toBe(0);
  });
});
