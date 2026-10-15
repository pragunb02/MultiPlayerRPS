import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "./index.js";

describe("ERROR_CODES", () => {
  it("uses each code as its own value, so clients can compare strings directly", () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });

  it("is immutable", () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
  });
});
