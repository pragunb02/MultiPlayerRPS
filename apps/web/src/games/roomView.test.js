import { describe, expect, it } from "vitest";
import { gameNumber, isYourTurn, nameOf, opponentsOf } from "./roomView.js";

const seats = [
  { playerId: "a", displayName: "Alice" },
  { playerId: "b", displayName: "Bob" },
  { playerId: "c", displayName: "Carol" },
];
const room = (overrides = {}) => ({
  you: "a",
  status: "playing",
  seats,
  game: { activePlayers: ["a"] },
  ...overrides,
});

describe("roomView readers", () => {
  it("names a seated player, and calls someone without a seat Someone", () => {
    expect(nameOf(room(), "b")).toBe("Bob");
    expect(nameOf(room(), "gone")).toBe("Someone");
  });

  it("lists everyone but the viewer", () => {
    expect(opponentsOf(room())).toBe("Bob and Carol");
    expect(opponentsOf(room({ you: "" }))).toBe("Alice and Bob and Carol");
  });

  it("knows when the viewer may act", () => {
    expect(isYourTurn(room())).toBe(true);
    expect(isYourTurn(room({ you: "b" }))).toBe(false);
    expect(isYourTurn(room({ you: "" }))).toBe(false);
    expect(isYourTurn(room({ status: "finished" }))).toBe(false);
  });

  it("counts the games of a room the same while playing and after finishing", () => {
    expect(gameNumber(room())).toBe(0);
    expect(gameNumber(room({ status: "finished", series: { games: 1 } }))).toBe(0);
    expect(gameNumber(room({ status: "playing", series: { games: 1 } }))).toBe(1);
    expect(gameNumber(room({ status: "finished", series: { games: 2 } }))).toBe(1);
  });
});
