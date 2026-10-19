import { GAME_STATUS, MOVE_REJECTIONS } from "@classicade/shared";
import { renamePlayer } from "../renamePlayer.js";
import { createSeededRng } from "../rng.js";

/**
 * Shared contract checks every GameEngine must pass. Each check throws a ContractViolation. Run them all
 * with `checkEngineContract`, which returns the violations, or with `describeEngineContract`, which adds one
 * Vitest test per check.
 *
 * @typedef {Object} ContractScenario
 * @property {string[]} players                    a valid player list
 * @property {unknown} options                     raw options that must validate
 * @property {unknown[]} [invalidOptions]          raw options that must be rejected
 * @property {Array<{ player: string, move: unknown }>} playthrough  legal moves from start to a finished game
 * @property {import("../engine.js").Outcome} expectedOutcome         outcome after the playthrough
 * @property {Array<{ player: string, move: unknown, reason: string }>} [rejectedMoves]  refused at the start
 * @property {number} [seed]
 */

export class ContractViolation extends Error {}

const OUTSIDER = "not-a-player";
const CTX = Object.freeze({ now: 1_700_000_000_000 });
const KNOWN_REASONS = new Set(Object.values(MOVE_REJECTIONS));
const GARBAGE = Object.freeze([
  undefined,
  null,
  0,
  -1,
  Number.NaN,
  "",
  "x".repeat(10_000),
  true,
  [],
  {},
  { type: "__proto__" },
  { constructor: { prototype: { polluted: true } } },
  JSON.parse('{"__proto__": {"polluted": true}}'),
  Object.freeze(Array.from({ length: 1_000 }, (_, i) => i)),
]);

function assert(condition, message) {
  if (!condition) {
    throw new ContractViolation(message);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/**
 * True only for data that survives JSON unchanged: null, booleans, finite numbers, strings, arrays and
 * plain objects of those. Dates, functions, undefined, NaN, Infinity, Maps and class instances fail.
 */
function isJsonSafe(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonSafe);
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    return (proto === Object.prototype || proto === null) && Object.values(value).every(isJsonSafe);
  }
  return false;
}

function setup(engine, scenario, seed = scenario.seed ?? 42) {
  const options = engine.validateOptions(scenario.options);
  assert(options.ok, `validateOptions rejected the scenario's options: ${options.message}`);
  return deepFreeze(
    engine.init({ players: [...scenario.players], options: options.value, rng: createSeededRng(seed) }),
  );
}

/** Plays the scenario, calling `onStep` before each move, and returns the final state. */
function play(engine, scenario, onStep = () => {}) {
  let state = setup(engine, scenario);
  scenario.playthrough.forEach(({ player, move }, index) => {
    onStep(state, index);
    const validated = engine.validateMove(state, player, move, CTX);
    assert(
      validated.ok,
      `step ${index}: legal move by ${player} was rejected (${validated.reason}: ${validated.message})`,
    );
    let next;
    try {
      next = engine.applyMove(state, player, validated.value, CTX);
    } catch (err) {
      throw new ContractViolation(
        `step ${index}: applyMove threw on frozen state — does it mutate its input? (${err.message})`,
      );
    }
    assert(next !== state, `step ${index}: applyMove must return a new state object`);
    state = deepFreeze(next);
  });
  return state;
}

const CHECKS = Object.freeze([
  {
    name: "validates and rejects options without throwing",
    run(engine, scenario) {
      assert(engine.validateOptions(scenario.options).ok, "valid options were rejected");
      for (const raw of [...(scenario.invalidOptions ?? []), ...GARBAGE.slice(0, 4)]) {
        const result = engine.validateOptions(raw);
        assert(
          result && typeof result.ok === "boolean",
          `validateOptions(${JSON.stringify(raw)}) must return a Result`,
        );
      }
      for (const raw of scenario.invalidOptions ?? []) {
        assert(!engine.validateOptions(raw).ok, `invalid options ${JSON.stringify(raw)} were accepted`);
      }
    },
  },
  {
    name: "starts deterministically from the same seed, with JSON-safe state",
    run(engine, scenario) {
      const a = setup(engine, scenario, 7);
      const b = setup(engine, scenario, 7);
      assert(JSON.stringify(a) === JSON.stringify(b), "init with the same seed produced different states");
      assert(isJsonSafe(a), "initial state is not plain JSON data");
    },
  },
  {
    name: "starts ongoing with active players drawn from the player list",
    run(engine, scenario) {
      const state = setup(engine, scenario);
      assert(engine.getOutcome(state).status === GAME_STATUS.ONGOING, "a new game must be ongoing");
      const active = engine.activePlayers(state);
      assert(Array.isArray(active) && active.length > 0, "a new game must have at least one active player");
      assert(
        active.every((p) => scenario.players.includes(p)),
        "active players must be game players",
      );
    },
  },
  {
    name: "never throws on garbage moves and rejects them with a known reason",
    run(engine, scenario) {
      const state = setup(engine, scenario);
      for (const player of [...scenario.players, OUTSIDER]) {
        for (const move of GARBAGE) {
          let result;
          try {
            result = engine.validateMove(state, player, move, CTX);
          } catch (err) {
            throw new ContractViolation(
              `validateMove threw for ${player} / ${String(JSON.stringify(move)).slice(0, 40)}: ${err.message}`,
            );
          }
          assert(
            result?.ok === false,
            `garbage move ${String(JSON.stringify(move)).slice(0, 40)} by ${player} was accepted`,
          );
          assert(KNOWN_REASONS.has(result.reason), `unknown rejection reason "${result.reason}"`);
        }
      }
      assert({}.polluted === undefined, "a move polluted Object.prototype");
    },
  },
  {
    name: "rejects moves from someone who is not in the game",
    run(engine, scenario) {
      const state = setup(engine, scenario);
      const { move } = scenario.playthrough[0];
      const result = engine.validateMove(state, OUTSIDER, move, CTX);
      assert(
        !result.ok && result.reason === MOVE_REJECTIONS.NOT_A_PLAYER,
        "outsider's move must be NOT_A_PLAYER",
      );
    },
  },
  {
    name: "rejects the scenario's illegal moves with the expected reasons",
    run(engine, scenario) {
      const state = setup(engine, scenario);
      for (const { player, move, reason } of scenario.rejectedMoves ?? []) {
        const result = engine.validateMove(state, player, move, CTX);
        assert(!result.ok, `move ${JSON.stringify(move)} by ${player} should be rejected`);
        assert(result.reason === reason, `expected ${reason}, got ${result.reason}`);
      }
    },
  },
  {
    name: "plays a legal game to the expected outcome without mutating state",
    run(engine, scenario) {
      const final = play(engine, scenario, (state, index) => {
        assert(
          engine.getOutcome(state).status === GAME_STATUS.ONGOING,
          `game finished early, before step ${index}`,
        );
        const { player } = scenario.playthrough[index];
        assert(
          engine.activePlayers(state).includes(player),
          `step ${index}: ${player} moved but was not active`,
        );
      });
      assert(
        JSON.stringify(engine.getOutcome(final)) === JSON.stringify(scenario.expectedOutcome),
        `expected outcome ${JSON.stringify(scenario.expectedOutcome)}, got ${JSON.stringify(engine.getOutcome(final))}`,
      );
      assert(isJsonSafe(final), "final state is not plain JSON data");
    },
  },
  {
    // A guest who signs in mid-game keeps their seat under their account's id (CC-083).
    name: "keeps playing after a player is renamed mid-game",
    run(engine, scenario) {
      const [from] = scenario.players;
      const to = "renamed-player";
      const half = Math.floor(scenario.playthrough.length / 2);
      const rest = scenario.playthrough.slice(half).map((step) => renamePlayer(step, from, to));
      let state = deepFreeze(
        renamePlayer(
          play(engine, { ...scenario, playthrough: scenario.playthrough.slice(0, half) }),
          from,
          to,
        ),
      );
      assert(!engine.activePlayers(state).includes(from), "the old id is still active after the rename");
      rest.forEach(({ player, move }, index) => {
        const validated = engine.validateMove(state, player, move, CTX);
        assert(
          validated.ok,
          `after rename, step ${half + index}: ${player}'s legal move was rejected (${validated.reason})`,
        );
        state = deepFreeze(engine.applyMove(state, player, validated.value, CTX));
      });
      const expected = renamePlayer(scenario.expectedOutcome, from, to);
      assert(
        JSON.stringify(engine.getOutcome(state)) === JSON.stringify(expected),
        `after rename, expected outcome ${JSON.stringify(expected)}, got ${JSON.stringify(engine.getOutcome(state))}`,
      );
    },
  },
  {
    name: "refuses every move once the game is over",
    run(engine, scenario) {
      const final = play(engine, scenario);
      assert(engine.activePlayers(final).length === 0, "no one may be active after the game ends");
      for (const { player, move } of scenario.playthrough) {
        const result = engine.validateMove(final, player, move, CTX);
        assert(
          !result.ok && result.reason === MOVE_REJECTIONS.GAME_OVER,
          "moves after the end must be GAME_OVER",
        );
      }
    },
  },
  {
    name: "renders JSON-safe views for every player and spectators at every step",
    run(engine, scenario) {
      const viewers = [...scenario.players, "spectator"];
      const check = (state) =>
        viewers.forEach((v) => assert(isJsonSafe(engine.viewFor(state, v)), `view for ${v} is not JSON`));
      check(play(engine, scenario, check));
    },
  },
  {
    name: "lists the game's players in seat order with playersOf, from start to end and after a rename",
    run(engine, scenario) {
      const same = (state, expected, when) =>
        assert(
          JSON.stringify(engine.playersOf(state)) === JSON.stringify(expected),
          `${when}: playersOf gave ${JSON.stringify(engine.playersOf(state))}, expected ${JSON.stringify(expected)}`,
        );
      const final = play(engine, scenario, (state, index) => same(state, scenario.players, `step ${index}`));
      same(final, scenario.players, "the end");
      const [from] = scenario.players;
      same(
        renamePlayer(final, from, "renamed-player"),
        scenario.players.map((p) => (p === from ? "renamed-player" : p)),
        "after a rename",
      );
    },
  },
  {
    // The server renames exactly the players playersOf lists before anything leaves it (CC-253). A view, an
    // outcome or an active list that named anyone else would send that id to the browser as it is.
    name: "names nobody but playersOf in any view, outcome or active list, in every state",
    run(engine, scenario) {
      const viewers = [...scenario.players, "spectator"];
      const check = (state, when) => {
        const shown = viewers.map((viewer) => ({
          view: engine.viewFor(state, viewer),
          outcome: engine.getOutcome(state),
          active: engine.activePlayers(state),
        }));
        const hidden = JSON.stringify(
          engine.playersOf(state).reduce((value, id, index) => renamePlayer(value, id, `seat-${index}`), shown),
        );
        for (const player of scenario.players) {
          assert(!hidden.includes(JSON.stringify(player)), `${when}: ${player} is named outside playersOf`);
        }
      };
      const each = (state, when) => {
        check(state, when);
        if (engine.deadline !== undefined && engine.deadline(state) > 0) {
          check(engine.expire(state, { now: engine.deadline(state) }), `${when}, expired`);
        }
        const [to, from] = scenario.players;
        for (const type of Object.keys(engine.requestTypes ?? {})) {
          check(engine.acceptRequest(state, { type, from, to }, CTX), `${when}, ${type} accepted`);
        }
      };
      each(
        play(engine, scenario, (state, index) => each(state, `step ${index}`)),
        "the end",
      );
    },
  },
  {
    name: "keeps time hooks pure: integer deadlines, no mutation, none after the end",
    run(engine, scenario) {
      if (engine.deadline === undefined) {
        return;
      }
      const final = play(engine, scenario, (state, index) => {
        const due = engine.deadline(state);
        assert(
          Number.isInteger(due) && due >= 0,
          `step ${index}: deadline must be a non-negative integer, got ${due}`,
        );
        let expired;
        try {
          expired = engine.expire(state, { now: due > 0 ? due : CTX.now });
        } catch (err) {
          throw new ContractViolation(
            `step ${index}: expire threw on frozen state — does it mutate? (${err.message})`,
          );
        }
        assert(isJsonSafe(expired), `step ${index}: expired state is not plain JSON data`);
        if (due > 0) {
          assert(
            engine.getOutcome(expired).status === GAME_STATUS.FINISHED || engine.deadline(expired) !== due,
            `step ${index}: expiring at the deadline must change the game`,
          );
        }
      });
      assert(engine.deadline(final) === 0, "a finished game must have no deadline");
    },
  },
  {
    name: "keeps request hooks pure: accepting changes the game, never mutates, and is plain data",
    run(engine, scenario) {
      if (engine.requestTypes === undefined) {
        return;
      }
      const [to, from] = scenario.players;
      play(engine, scenario, (state, index) => {
        for (const type of Object.keys(engine.requestTypes)) {
          let accepted;
          try {
            accepted = engine.acceptRequest(state, { type, from, to }, CTX);
          } catch (err) {
            throw new ContractViolation(
              `step ${index}: acceptRequest threw on frozen state, does it mutate? (${err.message})`,
            );
          }
          assert(
            isJsonSafe(accepted),
            `step ${index}: accepting ${type} gave a state that is not plain data`,
          );
          assert(
            JSON.stringify(accepted) !== JSON.stringify(state),
            `step ${index}: accepting ${type} during the game must change it`,
          );
        }
      });
    },
  },
  {
    name: "replays identically",
    run(engine, scenario) {
      assert(
        JSON.stringify(play(engine, scenario)) === JSON.stringify(play(engine, scenario)),
        "replay diverged",
      );
    },
  },
]);

export const CONTRACT_CHECK_NAMES = Object.freeze(CHECKS.map((c) => c.name));

/**
 * Runs every contract check and collects violations instead of stopping at the first.
 *
 * @param {import("../engine.js").GameEngine<any, any, any>} engine
 * @param {ContractScenario} scenario
 * @returns {Array<{ check: string, message: string }>}
 */
export function checkEngineContract(engine, scenario) {
  const violations = [];
  for (const { name, run } of CHECKS) {
    try {
      run(engine, scenario);
    } catch (err) {
      violations.push({ check: name, message: err.message });
    }
  }
  return violations;
}

/**
 * Registers one test per contract check, for use inside an engine's test file.
 *
 * @param {import("../engine.js").GameEngine<any, any, any>} engine
 * @param {ContractScenario} scenario
 * @param {{ describe: Function, it: Function }} vitest  pass `{ describe, it }` from "vitest"
 */
export function describeEngineContract(engine, scenario, { describe, it }) {
  describe(`${engine.id} engine contract`, () => {
    for (const { name, run } of CHECKS) {
      it(name, () => run(engine, scenario));
    }
  });
}
