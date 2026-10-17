import { describe, expect, it } from "vitest";
import { rpsSounds } from "./rpsAlerts.js";

const ME = "guest_me";
const BOB = "guest_bob";
const rps = (rounds, status = "playing") => ({ status, game: { view: { rounds } } });
const round = (winner) => ({ choices: { [ME]: "rock", [BOB]: "scissors" }, winner });

describe("Rock Paper Scissors sounds (CC-103)", () => {
  it("opens the hands and then says who won the round", () => {
    expect(rpsSounds(rps([]), rps([round(ME)]), ME)).toEqual(["reveal", "round-won"]);
    expect(rpsSounds(rps([]), rps([round(BOB)]), ME)).toEqual(["reveal", "round-lost"]);
  });

  it("plays only the reveal for a drawn round, for spectators, and on the last round", () => {
    expect(rpsSounds(rps([]), rps([round("")]), ME)).toEqual(["reveal"]);
    expect(rpsSounds(rps([]), rps([round(ME)]), "")).toEqual(["reveal"]);
    expect(rpsSounds(rps([round(ME)]), rps([round(ME), round(ME)], "finished"), ME)).toEqual(["reveal"]);
  });

  it("is quiet while choices are still hidden", () => {
    expect(rpsSounds(rps([round(ME)]), rps([round(ME)]), ME)).toEqual([]);
  });
});
