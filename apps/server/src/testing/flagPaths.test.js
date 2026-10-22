import { afterAll, describe, expect, it } from "vitest";
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

  // After every test, so a shuffled order (`--sequence.shuffle`) cannot check before both runs happened (CC-325).
  afterAll(() => {
    expect([...seen].sort()).toEqual([false, true]);
  });

  it("refuses a flag that is not registered", () => {
    expect(() => flagPaths("no_such_flag", () => {})).toThrow(/Unknown feature flag/);
  });
});
