import { describe, expect, it } from "vitest";
import { ValidationError } from "../utils/errors.js";
import { parseBirthYear } from "./birthYear.js";

describe("parseBirthYear", () => {
  it("accepts every year of the list, and one older for a browser still in last year", () => {
    expect(parseBirthYear(2026, { currentYear: 2026 })).toBe(2026);
    expect(parseBirthYear(1926, { currentYear: 2026 })).toBe(1926);
    expect(parseBirthYear(1925, { currentYear: 2026 })).toBe(1925);
  });

  it.each([[2027], [1924], [2001.5], ["2001"], [null], [Number.NaN]])("refuses %s", (value) => {
    expect(() => parseBirthYear(value, { currentYear: 2026 })).toThrow(ValidationError);
  });
});
