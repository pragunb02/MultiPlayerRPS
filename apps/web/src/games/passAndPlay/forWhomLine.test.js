import { describe, expect, it } from "vitest";
import { forWhomLine } from "./forWhomLine.js";

const ROOM = Object.freeze({
  seats: [
    { playerId: "player-1", displayName: "Asha" },
    { playerId: "player-2", displayName: "Ben" },
  ],
});

describe("forWhomLine", () => {
  it("names who wins when the choice ends the game", () => {
    const outcome = { status: "finished", result: "win", winners: ["player-2"] };

    expect(forWhomLine({ room: ROOM, label: "Resign for Asha", outcome })).toBe("Resign for Asha: Ben wins.");
  });

  it("says a draw when the choice ends the game in one", () => {
    const outcome = { status: "finished", result: "draw", winners: [] };

    expect(forWhomLine({ room: ROOM, label: "Stop for Asha", outcome })).toBe("Stop for Asha: a draw.");
  });

  it("says only the choice when the game goes on after it", () => {
    expect(forWhomLine({ room: ROOM, label: "Pass for Ben", outcome: { status: "ongoing" } })).toBe(
      "Pass for Ben.",
    );
  });
});
