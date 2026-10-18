import { describe, expect, it } from "vitest";
import { gameNumber, isYourTurn, nameOf, opponentsOf, seatOf } from "./roomView.js";

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

  it("numbers the games of a room as the server does, and 0 before the first one", () => {
    expect(gameNumber(room({ game: undefined }))).toBe(0);
    expect(gameNumber(room({ game: { activePlayers: [], number: 3 } }))).toBe(3);
  });

  it("finds a seat by player id", () => {
    expect(seatOf(room(), "b")).toEqual({ playerId: "b", displayName: "Bob" });
    expect(seatOf(room(), "z")).toBeUndefined();
  });
});
