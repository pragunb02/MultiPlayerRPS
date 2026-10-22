import { describe, expect, it } from "vitest";
import { AGE_GROUPS, ageGroupFor } from "@classicade/shared";
import { adultBirthYear, minorBirthYear } from "./birthYears.js";

describe("birth years for tests on the real clock (CC-325)", () => {
  it("are a minor's and an adult's in the year of now, whatever that year is", () => {
    for (const now of [Date.UTC(2026, 9, 20), Date.UTC(2031, 0, 1), Date.UTC(2046, 11, 31)]) {
      const currentYear = new Date(now).getUTCFullYear();

      expect(ageGroupFor({ birthYear: minorBirthYear(now), currentYear })).toBe(AGE_GROUPS.MINOR);
      expect(ageGroupFor({ birthYear: adultBirthYear(now), currentYear })).toBe(AGE_GROUPS.ADULT);
    }
    expect(minorBirthYear()).toBe(new Date().getUTCFullYear() - 15);
    expect(adultBirthYear()).toBe(new Date().getUTCFullYear() - 30);
  });
});
