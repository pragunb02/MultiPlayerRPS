import { describe, expect, it } from "vitest";
import { MOVE_REJECTIONS } from "@classicade/shared";
import { defineEngine } from "../engine.js";
import { ok } from "../result.js";
import { checkEngineContract, CONTRACT_CHECK_NAMES, describeEngineContract } from "./engineContract.js";
import { raceEngine } from "./raceEngine.js";

// Seed 42 makes bob start: bob +1, alice +2 reaches the target of 3.
const scenario = {
  players: ["alice", "bob"],
  options: { target: 3 },
  invalidOptions: [{ target: 1 }, { target: 99 }, {}],
  seed: 42,
  playthrough: [
    { player: "bob", move: { add: 1 } },
    { player: "alice", move: { add: 2 } },
  ],
  expectedOutcome: { status: "finished", result: "win", winners: ["alice"], reason: "reached-target" },
  rejectedMoves: [
    { player: "alice", move: { add: 1 }, reason: MOVE_REJECTIONS.NOT_YOUR_TURN },
    { player: "bob", move: { add: 3 }, reason: MOVE_REJECTIONS.INVALID_MOVE },
  ],
};

// The reference engine must pass every check — this is exactly how real engines use the kit.
describeEngineContract(raceEngine, scenario, { describe, it });

/** A copy of the reference engine with one behaviour broken. */
const broken = (overrides) => defineEngine({ ...raceEngine, ...overrides });
const violatedChecks = (engine) => checkEngineContract(engine, scenario).map((v) => v.check);

describe("checkEngineContract catches broken engines", () => {
  it("reports nothing for a correct engine", () => {
    expect(checkEngineContract(raceEngine, scenario)).toEqual([]);
  });

  it("catches an engine that mutates its input state", () => {
    const mutating = broken({
      applyMove(state, playerId, move) {
        state.count += move.add;
        return { ...state };
      },
    });

    expect(violatedChecks(mutating)).toContain(
      "plays a legal game to the expected outcome without mutating state",
    );
  });

  it("catches validateMove throwing on garbage input", () => {
    // Reads raw.add before checking raw exists, so `null`/`undefined` moves throw a TypeError.
    const fragile = broken({
      validateMove: (state, playerId, raw, ctx) =>
        raceEngine.validateMove(state, playerId, { add: raw.add }, ctx),
    });

    expect(violatedChecks(fragile)).toContain(
      "never throws on garbage moves and rejects them with a known reason",
    );
  });

  it("catches hidden randomness (non-deterministic init)", () => {
    const random = broken({
      init: (setup) => ({
        ...raceEngine.init(setup),
        turn: Math.random() < 0.5 ? 0 : 1,
        salt: Math.random(),
      }),
    });

    expect(violatedChecks(random)).toContain(
      "starts deterministically from the same seed, with JSON-safe state",
    );
  });

  it("catches state that is not plain JSON", () => {
    const withDate = broken({ init: (setup) => ({ ...raceEngine.init(setup), startedAt: new Date(0) }) });

    expect(violatedChecks(withDate)).toContain(
      "starts deterministically from the same seed, with JSON-safe state",
    );
  });

  it("catches accepting moves from outsiders", () => {
    const open = broken({
      validateMove: (state, playerId, raw, ctx) =>
        playerId === "not-a-player" ? ok({ add: 1 }) : raceEngine.validateMove(state, playerId, raw, ctx),
    });

    expect(violatedChecks(open)).toContain("rejects moves from someone who is not in the game");
  });

  it("catches accepting moves after the game ended", () => {
    const endless = broken({
      validateMove: (state, playerId, raw, ctx) =>
        state.winner !== "" && state.players.includes(playerId)
          ? ok({ add: 1 })
          : raceEngine.validateMove(state, playerId, raw, ctx),
    });

    expect(violatedChecks(endless)).toContain("refuses every move once the game is over");
  });

  it("catches a wrong outcome", () => {
    const sore = broken({
      getOutcome: (state) =>
        state.winner === ""
          ? raceEngine.getOutcome(state)
          : { status: "finished", result: "draw", winners: [], reason: "x" },
    });

    expect(violatedChecks(sore)).toContain(
      "plays a legal game to the expected outcome without mutating state",
    );
  });

  it.each([
    ["a function", { onClick: () => {} }],
    ["undefined", { missing: undefined }],
    ["NaN", { score: Number.NaN }],
    ["a Map", { seats: new Map() }],
  ])("catches state containing %s", (_label, extra) => {
    const bad = broken({ init: (setup) => ({ ...raceEngine.init(setup), ...extra }) });

    expect(violatedChecks(bad)).toContain(
      "starts deterministically from the same seed, with JSON-safe state",
    );
  });

  it("catches views that are not JSON-safe", () => {
    const leaky = broken({ viewFor: (state) => ({ ...state, toString: () => "x" }) });

    expect(violatedChecks(leaky)).toContain(
      "renders JSON-safe views for every player and spectators at every step",
    );
  });

  it("collects every violation instead of stopping at the first", () => {
    const veryBroken = broken({ validateMove: () => ok({ add: 1 }) });

    expect(violatedChecks(veryBroken).length).toBeGreaterThan(1);
  });

  it("exposes the list of checks", () => {
    expect(CONTRACT_CHECK_NAMES).toHaveLength(10);
  });
});
