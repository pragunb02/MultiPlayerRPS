import { describe, expect, it } from "vitest";
import { defineEngine } from "./engine.js";
import { createEngineRegistry } from "./registry.js";
import { raceEngine } from "./testing/raceEngine.js";

const otherEngine = defineEngine({ ...raceEngine, id: "other" });

describe("createEngineRegistry", () => {
  it("looks engines up by id", () => {
    const registry = createEngineRegistry([raceEngine, otherEngine]);

    expect(registry.get("race")).toBe(raceEngine);
    expect(registry.get("other")).toBe(otherEngine);
    expect(registry.has("race")).toBe(true);
    expect(registry.has("chess")).toBe(false);
    expect(registry.ids()).toEqual(["race", "other"]);
  });

  it("throws for an unregistered id instead of returning nothing", () => {
    expect(() => createEngineRegistry([raceEngine]).get("chess")).toThrow(RangeError);
  });

  it("refuses duplicate ids", () => {
    expect(() => createEngineRegistry([raceEngine, raceEngine])).toThrow(/Duplicate game engine id "race"/);
  });

  it("is immutable", () => {
    const registry = createEngineRegistry([raceEngine]);

    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.ids())).toBe(true);
  });
});
