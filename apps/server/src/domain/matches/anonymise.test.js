import { describe, expect, it } from "vitest";
import { anonymisedMatch } from "./anonymise.js";

const STAND = Object.freeze({ id: "deleted_1", displayName: "Deleted player" });
const MATCH = Object.freeze({
  players: [
    { playerId: "user_x", displayName: "riya" },
    { playerId: "guest_b", displayName: "Bob" },
  ],
  log: [{ kind: "move", playerId: "user_x", at: 1 }],
  result: { winners: ["user_x"] },
});

describe("anonymisedMatch (CC-035)", () => {
  it("gives the stand-in the player's id and name everywhere, and leaves the others alone", () => {
    const out = anonymisedMatch(MATCH, { playerId: "user_x", stand: STAND });

    expect(out.players).toEqual([
      { playerId: "deleted_1", displayName: "Deleted player" },
      { playerId: "guest_b", displayName: "Bob" },
    ]);
    expect(out.log[0].playerId).toBe("deleted_1");
    expect(out.result.winners).toEqual(["deleted_1"]);
    expect(out).not.toHaveProperty("credit");
  });

  it("drops the former guest id from the stand-in's credit, and keeps the other player's", () => {
    const credit = {
      notCounted: [
        { playerId: "user_x", reason: "hourly-limit", withdrawnFrom: "guest_old" },
        { playerId: "guest_b", reason: "ended-too-soon" },
      ],
      botXp: [
        { playerId: "user_x", xp: 0, withdrawnFrom: "guest_old" },
        { playerId: "guest_b", xp: 10, withdrawnFrom: "guest_bob_old" },
      ],
    };

    const out = anonymisedMatch({ ...MATCH, credit }, { playerId: "user_x", stand: STAND });

    expect(out.credit).toEqual({
      notCounted: [
        { playerId: "deleted_1", reason: "hourly-limit" },
        { playerId: "guest_b", reason: "ended-too-soon" },
      ],
      botXp: [
        { playerId: "deleted_1", xp: 0 },
        { playerId: "guest_b", xp: 10, withdrawnFrom: "guest_bob_old" },
      ],
    });
  });

  it("handles a credit without computer XP", () => {
    const out = anonymisedMatch(
      { ...MATCH, credit: { notCounted: [] } },
      { playerId: "user_x", stand: STAND },
    );

    expect(out.credit).toEqual({ notCounted: [] });
  });
});
