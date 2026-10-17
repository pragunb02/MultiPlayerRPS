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

  it("accepts the optional time hooks when both are provided", () => {
    const timed = defineEngine({ ...valid, deadline: () => 0, expire: (state) => state });

    expect(typeof timed.deadline).toBe("function");
  });

  it.each([
    [{ ...valid, deadline: () => 0 }],
    [{ ...valid, expire: (state) => state }],
    [{ ...valid, deadline: 5, expire: (state) => state }],
  ])("refuses half or malformed time hooks (%#)", (engine) => {
    expect(() => defineEngine(engine)).toThrow(/deadline and expire must be provided together/);
  });

  it("accepts a turn limit and request types with what accepting them does, and freezes the rules", () => {
    const engine = defineEngine({
      ...valid,
      turnLimitMs: 30_000,
      requestTypes: { truce: { lifetimeMs: 30_000, limitPerPlayer: 3 } },
      acceptRequest: (state) => state,
    });

    expect(engine.turnLimitMs).toBe(30_000);
    expect(engine.requestTypes).toEqual({ truce: { lifetimeMs: 30_000, limitPerPlayer: 3 } });
    expect(Object.isFrozen(engine.requestTypes)).toBe(true);
    expect(Object.isFrozen(engine.requestTypes.truce)).toBe(true);
  });

  it.each([0, -1, 1.5, "30s"])("refuses a turn limit of %s", (turnLimitMs) => {
    expect(() => defineEngine({ ...valid, turnLimitMs })).toThrow(/turnLimitMs must be a positive/);
  });

  it.each([
    [{ ...valid, requestTypes: { truce: { lifetimeMs: 1, limitPerPlayer: 1 } } }],
    [{ ...valid, acceptRequest: (state) => state }],
    [{ ...valid, requestTypes: null, acceptRequest: (state) => state }],
    [{ ...valid, requestTypes: { truce: { lifetimeMs: 1, limitPerPlayer: 1 } }, acceptRequest: "yes" }],
  ])("refuses half or malformed request hooks (%#)", (engine) => {
    expect(() => defineEngine(engine)).toThrow(/requestTypes and acceptRequest must be provided together/);
  });

  it.each([
    [{ truce: { lifetimeMs: 0, limitPerPlayer: 1 } }, /truce needs a positive lifetimeMs and limitPerPlayer/],
    [{ truce: { lifetimeMs: 1, limitPerPlayer: 0 } }, /truce needs a positive lifetimeMs and limitPerPlayer/],
    [{ truce: undefined }, /truce needs a positive lifetimeMs and limitPerPlayer/],
    [{ rematch: { lifetimeMs: 1, limitPerPlayer: 1 } }, /request type rematch belongs to the room/],
  ])("refuses a request type that is not set up right (%#)", (requestTypes, message) => {
    expect(() => defineEngine({ ...valid, requestTypes, acceptRequest: (state) => state })).toThrow(message);
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
