import { describe, expect, it } from "vitest";
import { createSeededRng } from "./rng.js";
import { chooseStarter } from "./starter.js";

const PLAYERS = Object.freeze(["alice", "bob"]);
/** Random numbers that fail the test if anything draws from them. */
const untouched = () => {
  throw new Error("the random numbers were used");
};

describe("chooseStarter (CC-091)", () => {
  it("draws the starter from the seed when none is named", () => {
    // Seed 42 picks the second player and seed 7 the first.
    expect(chooseStarter({ players: PLAYERS, rng: createSeededRng(42) })).toBe("bob");
    expect(chooseStarter({ players: PLAYERS, rng: createSeededRng(7) })).toBe("alice");
  });

  it("takes the named starter without drawing a random number", () => {
    expect(chooseStarter({ players: PLAYERS, rng: untouched, starter: "alice" })).toBe("alice");
    expect(chooseStarter({ players: PLAYERS, rng: untouched, starter: "bob" })).toBe("bob");
  });

  it("refuses a starter who is not one of the players", () => {
    expect(() => chooseStarter({ players: PLAYERS, rng: untouched, starter: "carol" })).toThrow(TypeError);
  });
});
