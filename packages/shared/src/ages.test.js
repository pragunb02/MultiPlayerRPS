import { describe, expect, it } from "vitest";
import {
  AGE_GROUPS,
  ageGroupFor,
  BIRTH_YEAR_CHOICES,
  birthYearChoices,
  isTooYoungForAccount,
} from "./index.js";

describe("ageGroupFor", () => {
  it("calls a player without a birth year unknown", () => {
    expect(ageGroupFor({ currentYear: 2026 })).toBe(AGE_GROUPS.UNKNOWN);
  });

  it("calls a player an adult only when they are surely 18 already", () => {
    expect(ageGroupFor({ birthYear: 2007, currentYear: 2026 })).toBe(AGE_GROUPS.ADULT);
    expect(ageGroupFor({ birthYear: 1950, currentYear: 2026 })).toBe(AGE_GROUPS.ADULT);
  });

  it("calls a player who turns 18 this year a minor, because the birthday may be ahead", () => {
    expect(ageGroupFor({ birthYear: 2008, currentYear: 2026 })).toBe(AGE_GROUPS.MINOR);
    expect(ageGroupFor({ birthYear: 2013, currentYear: 2026 })).toBe(AGE_GROUPS.MINOR);
  });

  it("has frozen, distinct groups", () => {
    expect(Object.isFrozen(AGE_GROUPS)).toBe(true);
    expect(new Set(Object.values(AGE_GROUPS)).size).toBe(3);
  });
});

describe("isTooYoungForAccount", () => {
  it("refuses only a player who is under 13 for the whole year", () => {
    expect(isTooYoungForAccount({ birthYear: 2014, currentYear: 2026 })).toBe(true);
    expect(isTooYoungForAccount({ birthYear: 2026, currentYear: 2026 })).toBe(true);
    expect(isTooYoungForAccount({ birthYear: 2013, currentYear: 2026 })).toBe(false);
  });
});

describe("birthYearChoices", () => {
  it("lists this year first and goes back 100 years, with nothing left out for any age", () => {
    const years = birthYearChoices(2026);

    expect(years).toHaveLength(BIRTH_YEAR_CHOICES);
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(1926);
    expect(Object.isFrozen(years)).toBe(true);
  });
});
