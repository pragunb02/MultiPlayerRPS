import { describe, expect, it } from "vitest";
import { chessTurnLabel } from "./chessPassAndPlay.js";

const roomWith = (mover) => ({
  seats: [
    { playerId: "player-1", displayName: "Asha" },
    { playerId: "player-2", displayName: "Ben" },
  ],
  game: { activePlayers: [mover], view: { colors: { "player-1": "w", "player-2": "b" } } },
});

describe("chessTurnLabel", () => {
  it("names the player to move and their colour", () => {
    expect(chessTurnLabel(roomWith("player-1"))).toBe("Asha (White) to move");
    expect(chessTurnLabel(roomWith("player-2"))).toBe("Ben (Black) to move");
  });
});
