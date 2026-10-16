import { describe, expect, it } from "vitest";
import { MOVE_REJECTIONS } from "@classicade/shared";
import { createSeededRng } from "../rng.js";
import { describeEngineContract } from "../testing/engineContract.js";
import { rpsEngine } from "./rpsEngine.js";

const A = "alice";
const B = "bob";
const CTX = { now: 0 };

describeEngineContract(
  rpsEngine,
  {
    players: [A, B],
    options: { bestOf: 3 },
    invalidOptions: [{ bestOf: 2 }, { bestOf: 0 }, { bestOf: "3" }, { bestOf: 9 }, null, "x", []],
    playthrough: [
      { player: A, move: { choice: "rock" } },
      { player: B, move: { choice: "scissors" } }, // A 1–0
      { player: A, move: { choice: "paper" } },
      { player: B, move: { choice: "paper" } }, // draw, replayed
      { player: B, move: { choice: "rock" } },
      { player: A, move: { choice: "paper" } }, // A 2–0 → wins best of 3
    ],
    expectedOutcome: { status: "finished", result: "win", winners: [A], reason: "best-of-3" },
    rejectedMoves: [
      { player: A, move: { choice: "lizard" }, reason: MOVE_REJECTIONS.INVALID_MOVE },
      { player: A, move: { choice: "Rock" }, reason: MOVE_REJECTIONS.INVALID_MOVE },
      { player: A, move: "rock", reason: MOVE_REJECTIONS.INVALID_MOVE },
    ],
  },
  { describe, it },
);

const newGame = (bestOf = 3) => {
  const options = rpsEngine.validateOptions({ bestOf });
  return rpsEngine.init({ players: [A, B], options: options.value, rng: createSeededRng(1) });
};

/** Plays one round: A then B. */
function round(state, a, b) {
  const afterA = rpsEngine.applyMove(state, A, { choice: a }, CTX);
  return rpsEngine.applyMove(afterA, B, { choice: b }, CTX);
}

describe("rpsEngine rules", () => {
  it.each([
    ["rock", "scissors", A],
    ["scissors", "paper", A],
    ["paper", "rock", A],
    ["scissors", "rock", B],
    ["paper", "scissors", B],
    ["rock", "paper", B],
    ["rock", "rock", ""],
    ["paper", "paper", ""],
    ["scissors", "scissors", ""],
  ])("%s vs %s → winner %j", (a, b, winner) => {
    const state = round(newGame(), a, b);

    expect(state.rounds).toEqual([{ choices: { [A]: a, [B]: b }, winner }]);
  });

  it("lets scissors win (regression: the legacy app compared 'Scissor' with 'Scissors' — BUG-01)", () => {
    expect(round(newGame(), "scissors", "paper").score).toEqual({ [A]: 1, [B]: 0 });
  });

  it("defaults to best of 3 when no option is given", () => {
    expect(rpsEngine.validateOptions({})).toEqual({ ok: true, value: { bestOf: 3 } });
  });

  it.each([
    [1, 1],
    [3, 2],
    [5, 3],
    [7, 4],
  ])("best of %i ends when someone wins %i rounds", (bestOf, needed) => {
    let state = newGame(bestOf);
    for (let i = 0; i < needed - 1; i++) {
      state = round(state, "rock", "scissors");
      expect(rpsEngine.getOutcome(state).status).toBe("ongoing");
    }

    state = round(state, "rock", "scissors");

    expect(rpsEngine.getOutcome(state)).toEqual({
      status: "finished",
      result: "win",
      winners: [A],
      reason: `best-of-${bestOf}`,
    });
  });

  it("replays drawn rounds without counting them", () => {
    const state = round(round(newGame(1), "rock", "rock"), "paper", "paper");

    expect(state.score).toEqual({ [A]: 0, [B]: 0 });
    expect(state.rounds).toHaveLength(2);
    expect(rpsEngine.getOutcome(state).status).toBe("ongoing");
  });

  it("refuses a second choice in the same round", () => {
    const state = rpsEngine.applyMove(newGame(), A, { choice: "rock" }, CTX);

    expect(rpsEngine.validateMove(state, A, { choice: "paper" }, CTX)).toEqual(
      expect.objectContaining({ ok: false, reason: MOVE_REJECTIONS.NOT_YOUR_TURN }),
    );
  });

  it("lets either player choose first, and waits only for whoever has not chosen", () => {
    const state = rpsEngine.applyMove(newGame(), B, { choice: "paper" }, CTX);

    expect(rpsEngine.activePlayers(newGame())).toEqual([A, B]);
    expect(rpsEngine.activePlayers(state)).toEqual([A]);
  });

  it("only accepts the documented choice values", () => {
    for (const choice of ["Rock", "SCISSORS", "scissor", "lizard", "", 1]) {
      expect(rpsEngine.validateMove(newGame(), A, { choice }, CTX).reason).toBe(MOVE_REJECTIONS.INVALID_MOVE);
    }
  });
});

describe("rpsEngine hidden information (SEC-09)", () => {
  const afterAliceChose = () => rpsEngine.applyMove(newGame(), A, { choice: "rock" }, CTX);

  it("never reveals a pending choice to the opponent", () => {
    const view = rpsEngine.viewFor(afterAliceChose(), B);

    expect(view.hasChosen).toEqual({ [A]: true, [B]: false });
    expect(view.yourChoice).toBe("");
    expect(JSON.stringify(view)).not.toContain("rock");
  });

  it("never reveals pending choices to spectators", () => {
    expect(JSON.stringify(rpsEngine.viewFor(afterAliceChose(), "spectator"))).not.toContain("rock");
  });

  it("shows players their own pending choice", () => {
    expect(rpsEngine.viewFor(afterAliceChose(), A).yourChoice).toBe("rock");
  });

  it("reveals both choices once the round is resolved", () => {
    const state = rpsEngine.applyMove(afterAliceChose(), B, { choice: "paper" }, CTX);

    expect(rpsEngine.viewFor(state, B).rounds).toEqual([
      { choices: { [A]: "rock", [B]: "paper" }, winner: B },
    ]);
  });

  it("reports score and round number", () => {
    const view = rpsEngine.viewFor(round(newGame(), "rock", "scissors"), A);

    expect(view).toEqual(expect.objectContaining({ bestOf: 3, score: { [A]: 1, [B]: 0 }, round: 2 }));
  });
});
