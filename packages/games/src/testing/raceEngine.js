import { GAME_STATUS, MOVE_REJECTIONS } from "@classicade/shared";
import { defineEngine } from "../engine.js";
import { randomIndex } from "../rng.js";
import { ok, reject } from "../result.js";

/**
 * A tiny reference engine used to test the engine tooling itself (not a real game).
 * Players take turns adding 1 or 2 to a counter, and whoever reaches `target` exactly wins.
 * The starting player is chosen with the injected RNG.
 */
export const raceEngine = defineEngine({
  id: "race",
  players: { min: 2, max: 2 },

  validateOptions(raw) {
    const target = raw?.target;
    if (!Number.isInteger(target) || target < 3 || target > 21) {
      return reject(MOVE_REJECTIONS.INVALID_MOVE, "target must be an integer between 3 and 21");
    }
    return ok({ target });
  },

  init({ players, options, rng }) {
    return { players, target: options.target, count: 0, turn: randomIndex(rng, players.length), winner: "" };
  },

  validateMove(state, playerId, raw) {
    if (!state.players.includes(playerId)) {
      return reject(MOVE_REJECTIONS.NOT_A_PLAYER, "You are not in this game");
    }
    if (state.winner !== "") {
      return reject(MOVE_REJECTIONS.GAME_OVER, "The game is over");
    }
    if (state.players[state.turn] !== playerId) {
      return reject(MOVE_REJECTIONS.NOT_YOUR_TURN, "Wait for your turn");
    }
    const step = raw?.add;
    if (step !== 1 && step !== 2) {
      return reject(MOVE_REJECTIONS.INVALID_MOVE, "Add 1 or 2");
    }
    if (state.count + step > state.target) {
      return reject(MOVE_REJECTIONS.ILLEGAL_MOVE, "That would overshoot the target");
    }
    return ok({ add: step });
  },

  applyMove(state, playerId, move) {
    const count = state.count + move.add;
    return {
      ...state,
      count,
      turn: (state.turn + 1) % state.players.length,
      winner: count === state.target ? playerId : "",
    };
  },

  getOutcome(state) {
    return state.winner === ""
      ? { status: GAME_STATUS.ONGOING }
      : { status: GAME_STATUS.FINISHED, result: "win", winners: [state.winner], reason: "reached-target" };
  },

  viewFor(state) {
    return {
      count: state.count,
      target: state.target,
      toMove: state.winner === "" ? state.players[state.turn] : "",
    };
  },

  playersOf: (state) => [...state.players],

  activePlayers(state) {
    return state.winner === "" ? [state.players[state.turn]] : [];
  },
});
