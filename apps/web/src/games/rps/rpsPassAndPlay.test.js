import { describe, expect, it } from "vitest";
import { rpsHandOverNote } from "./rpsPassAndPlay.js";

const roomWith = (rounds, score) => ({
  seats: [
    { playerId: "player-1", displayName: "Asha" },
    { playerId: "player-2", displayName: "Ben" },
  ],
  game: { view: { rounds, score } },
});

describe("rpsHandOverNote", () => {
  it("says nothing before the first round", () => {
    expect(rpsHandOverNote(roomWith([], { "player-1": 0, "player-2": 0 }))).toBe("");
  });

  it("names both choices, the round's winner and the score", () => {
    const rounds = [{ choices: { "player-1": "rock", "player-2": "scissors" }, winner: "player-1" }];

    expect(rpsHandOverNote(roomWith(rounds, { "player-1": 1, "player-2": 0 }))).toBe(
      "Round 1: Asha played Rock, Ben played Scissors. Asha won the round. Score: Asha 1, Ben 0.",
    );
  });

  it("says a drawn round is played again", () => {
    const rounds = [
      { choices: { "player-1": "rock", "player-2": "scissors" }, winner: "player-1" },
      { choices: { "player-1": "paper", "player-2": "paper" }, winner: "" },
    ];

    expect(rpsHandOverNote(roomWith(rounds, { "player-1": 1, "player-2": 0 }))).toBe(
      "Round 2: Asha played Paper, Ben played Paper. A draw, so the round is played again. Score: Asha 1, Ben 0.",
    );
  });
});
