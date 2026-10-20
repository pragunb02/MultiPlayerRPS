import { describe, expect, it } from "vitest";
import { FLAGS } from "@classicade/shared";
import { flagPaths } from "./flagPaths.js";

// The helper itself (CC-312). The name is not written out, so this does not count as the flag's own suite.
const seen = [];
const [first] = FLAGS;

describe("flagPaths", () => {
  flagPaths(first.name, (on) => {
    it("runs the suite with the flag on and with it off", () => {
      seen.push(on);
      expect(typeof on).toBe("boolean");
    });
  });

  it("ran it both ways", () => {
    expect(seen).toEqual([true, false]);
  });

  it("refuses a flag that is not registered", () => {
    expect(() => flagPaths("no_such_flag", () => {})).toThrow(/Unknown feature flag/);
  });
});
