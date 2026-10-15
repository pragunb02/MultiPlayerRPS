import { describe, expect, it } from "vitest";
import { assertDefined, assertFunction } from "./assert.js";

describe("assertDefined", () => {
  it.each([undefined, null])("throws for %s", (value) => {
    expect(() => assertDefined(value, "logger")).toThrow(new TypeError("logger is required"));
  });

  it.each([0, "", false, {}])("accepts %o", (value) => {
    expect(() => assertDefined(value, "x")).not.toThrow();
  });
});

describe("assertFunction", () => {
  it("throws for non-functions", () => {
    expect(() => assertFunction({}, "now")).toThrow(new TypeError("now must be a function"));
  });

  it("accepts functions", () => {
    expect(() => assertFunction(() => 1, "now")).not.toThrow();
  });
});
