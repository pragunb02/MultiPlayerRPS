import { describe, expect, it } from "vitest";
import { defineEngine } from "./engine.js";
import { raceEngine } from "./testing/raceEngine.js";

const valid = { ...raceEngine };

describe("defineEngine", () => {
  it("returns a frozen engine, including its player limits", () => {
    const engine = defineEngine(valid);

    expect(Object.isFrozen(engine)).toBe(true);
    expect(Object.isFrozen(engine.players)).toBe(true);
    expect(engine.id).toBe("race");
  });

  it.each([
    [{ ...valid, id: "Has Spaces" }, /id must be/],
    [{ ...valid, id: undefined }, /id must be/],
    [{ ...valid, players: { min: 0, max: 2 } }, /players must be/],
    [{ ...valid, players: { min: 3, max: 2 } }, /players must be/],
    [{ ...valid, players: { min: 2, max: 9 } }, /players must be/],
    [{ ...valid, players: undefined }, /players must be/],
    [{ ...valid, applyMove: undefined }, /applyMove must be a function/],
    [{ ...valid, viewFor: "nope" }, /viewFor must be a function/],
  ])("rejects a malformed engine (%#)", (engine, message) => {
    expect(() => defineEngine(engine)).toThrow(message);
  });

  it("lists every problem at once", () => {
    expect(() => defineEngine({})).toThrow(
      /id must be[\s\S]*players must be[\s\S]*validateOptions must be a function/,
    );
  });

  it.each([undefined, null])("rejects %s", (engine) => {
    expect(() => defineEngine(engine)).toThrow(TypeError);
  });
});
