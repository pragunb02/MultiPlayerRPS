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

// The reference engine must pass every check. This is exactly how real engines use the kit.
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

  it("catches playersOf out of seat order (CC-253)", () => {
    const reversed = broken({ playersOf: (state) => [...state.players].reverse() });

    expect(violatedChecks(reversed)).toEqual([
      "lists the game's players in seat order with playersOf, from start to end and after a rename",
    ]);
  });

  it("catches a view that names a player playersOf leaves out, so the server would send their id (CC-253)", () => {
    const forgetful = broken({ playersOf: (state) => [state.players[0]] });

    expect(violatedChecks(forgetful)).toEqual([
      "lists the game's players in seat order with playersOf, from start to end and after a rename",
      "names nobody but playersOf in any view, outcome or active list, in every state",
    ]);
  });

  it("catches views that are not JSON-safe", () => {
    const leaky = broken({ viewFor: (state) => ({ ...state, toString: () => "x" }) });

    expect(violatedChecks(leaky)).toContain(
      "renders JSON-safe views for every player and spectators at every step",
    );
  });

  describe("time hooks", () => {
    // A timed variant: every turn has a deadline one second after the last move.
    const timed = (overrides) =>
      broken({
        deadline: (state) => (state.winner === "" ? 1_700_000_001_000 : 0),
        expire: (state) => ({ ...state, winner: state.players[0] }),
        ...overrides,
      });
    const TIME_CHECK = "keeps time hooks pure: integer deadlines, no mutation, none after the end";

    it("accepts well-behaved hooks", () => {
      expect(violatedChecks(timed({}))).toEqual([]);
    });

    it("catches an expire that mutates state", () => {
      const mutating = timed({
        expire: (state) => {
          state.winner = state.players[0];
          return state;
        },
      });

      expect(violatedChecks(mutating)).toContain(TIME_CHECK);
    });

    it("catches a deadline that is not an integer", () => {
      expect(violatedChecks(timed({ deadline: () => 1.5 }))).toContain(TIME_CHECK);
    });

    it("catches a deadline that survives the end of the game", () => {
      expect(violatedChecks(timed({ deadline: () => 1_700_000_001_000 }))).toContain(TIME_CHECK);
    });

    it("catches an expire that changes nothing at the deadline", () => {
      expect(violatedChecks(timed({ expire: (state) => state }))).toContain(TIME_CHECK);
    });
  });

  describe("request hooks", () => {
    // A variant with a truce request: accepting it ends the race with no winner.
    const withTruce = (acceptRequest) =>
      broken({ requestTypes: { truce: { lifetimeMs: 1_000, limitPerPlayer: 1 } }, acceptRequest });
    const REQUEST_CHECK =
      "keeps request hooks pure: accepting changes the game, never mutates, and is plain data";

    it("accepts well-behaved hooks", () => {
      expect(violatedChecks(withTruce((state) => ({ ...state, winner: "truce" })))).toEqual([]);
    });

    it("catches an acceptRequest that mutates state", () => {
      const mutating = withTruce((state) => {
        state.winner = "truce";
        return state;
      });

      expect(violatedChecks(mutating)).toContain(REQUEST_CHECK);
    });

    it("catches an acceptRequest that gives something other than plain data", () => {
      expect(violatedChecks(withTruce((state) => ({ ...state, at: new Date(0) })))).toContain(REQUEST_CHECK);
    });

    it("catches an acceptRequest that changes nothing", () => {
      expect(violatedChecks(withTruce((state) => state))).toContain(REQUEST_CHECK);
    });
  });

  describe("starter hook (CC-091)", () => {
    // A variant that takes a starter: the named player moves first, otherwise the seed decides.
    const withStarter = (overrides) =>
      broken({
        init: (setup) => ({
          ...raceEngine.init(setup),
          ...(setup.starter !== undefined && { turn: setup.players.indexOf(setup.starter) }),
        }),
        starterOf: (state) => state.players[state.turn],
        ...overrides,
      });
    const STARTER_CHECK = "lets a named starter move first, and starterOf names who started";

    it("accepts a well-behaved hook", () => {
      expect(violatedChecks(withStarter({}))).toEqual([]);
    });

    it("catches an init that ignores the starter it was given", () => {
      expect(violatedChecks(withStarter({ init: raceEngine.init }))).toContain(STARTER_CHECK);
    });

    it("catches a starterOf that names someone outside the game", () => {
      expect(violatedChecks(withStarter({ starterOf: () => "not-a-player" }))).toContain(STARTER_CHECK);
    });

    it("catches a starter who is named but does not move first", () => {
      const both = withStarter({ activePlayers: (state) => [...state.players] });

      expect(checkEngineContract(both, scenario)).toContainEqual({
        check: STARTER_CHECK,
        message: "alice was named the starter but is not the only player to move",
      });
    });
  });

  it("collects every violation instead of stopping at the first", () => {
    const veryBroken = broken({ validateMove: () => ok({ add: 1 }) });

    expect(violatedChecks(veryBroken).length).toBeGreaterThan(1);
  });

  it("exposes the list of checks", () => {
    expect(CONTRACT_CHECK_NAMES).toHaveLength(16);
  });
});
