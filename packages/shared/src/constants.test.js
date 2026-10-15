import { describe, expect, it } from "vitest";
import { IDENTITY_KINDS, SOCKET_EVENTS } from "./index.js";

describe.each([
  ["IDENTITY_KINDS", IDENTITY_KINDS],
  ["SOCKET_EVENTS", SOCKET_EVENTS],
])("%s", (_name, constants) => {
  it("is immutable", () => {
    expect(Object.isFrozen(constants)).toBe(true);
  });

  it("has unique values", () => {
    const values = Object.values(constants);
    expect(new Set(values).size).toBe(values.length);
  });
});
