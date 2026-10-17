import { GAME_IDS, GAME_STATUS, MOVE_REJECTIONS, RPS_BEST_OF, RPS_CHOICES } from "@classicade/shared";
import { defineEngine } from "../engine.js";
import { ok, reject } from "../result.js";

const DEFAULT_BEST_OF = 3;
const CHOICES = new Set(Object.values(RPS_CHOICES));

/** What each choice defeats. */
const BEATS = Object.freeze({
  [RPS_CHOICES.ROCK]: RPS_CHOICES.SCISSORS,
  [RPS_CHOICES.PAPER]: RPS_CHOICES.ROCK,
  [RPS_CHOICES.SCISSORS]: RPS_CHOICES.PAPER,
});

/**
 * @typedef {Object} RpsState
 * @property {[string, string]} players
 * @property {number} bestOf
 * @property {number} winsNeeded
 * @property {Record<string, string>} pending   this round's secret choices ("" = not chosen yet)
 * @property {Array<{ choices: Record<string, string>, winner: string }>} rounds  finished rounds. winner is "" for a draw.
 * @property {Record<string, number>} score
 * @property {string} winner                     "" until someone reaches winsNeeded
 */

/** @returns {string} the winning player id, or "" for a draw */
function roundWinner([a, b], choices) {
  if (choices[a] === choices[b]) {
    return "";
  }
  return BEATS[choices[a]] === choices[b] ? a : b;
}

const fill = (players, value) => Object.fromEntries(players.map((p) => [p, value]));

/**
 * Rock Paper Scissors, best of N. Both players choose at the same time, and a choice stays secret until both
 * have chosen. Drawn rounds are replayed and do not count towards the match.
 */
export const rpsEngine = defineEngine({
  id: GAME_IDS.RPS,
  players: { min: 2, max: 2 },

  validateOptions(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return reject(MOVE_REJECTIONS.INVALID_MOVE, "options must be an object");
    }
    const bestOf = raw.bestOf ?? DEFAULT_BEST_OF;
    if (!RPS_BEST_OF.includes(bestOf)) {
      return reject(MOVE_REJECTIONS.INVALID_MOVE, `bestOf must be one of ${RPS_BEST_OF.join(", ")}`);
    }
    return ok({ bestOf });
  },

  /** @returns {RpsState} */
  init({ players, options }) {
    return {
      players: [players[0], players[1]],
      bestOf: options.bestOf,
      winsNeeded: Math.ceil(options.bestOf / 2),
      pending: fill(players, ""),
      rounds: [],
      score: fill(players, 0),
      winner: "",
    };
  },

  validateMove(state, playerId, raw) {
    if (!state.players.includes(playerId)) {
      return reject(MOVE_REJECTIONS.NOT_A_PLAYER, "You are not in this game");
    }
    if (state.winner !== "") {
      return reject(MOVE_REJECTIONS.GAME_OVER, "The match is over");
    }
    if (state.pending[playerId] !== "") {
      return reject(MOVE_REJECTIONS.NOT_YOUR_TURN, "You already chose — waiting for your opponent");
    }
    const choice = raw?.choice;
    if (typeof choice !== "string" || !CHOICES.has(choice)) {
      return reject(MOVE_REJECTIONS.INVALID_MOVE, "Choose rock, paper or scissors");
    }
    return ok({ choice });
  },

  applyMove(state, playerId, { choice }) {
    const pending = { ...state.pending, [playerId]: choice };
    if (state.players.some((p) => pending[p] === "")) {
      return { ...state, pending };
    }
    const winner = roundWinner(state.players, pending);
    const score = winner === "" ? state.score : { ...state.score, [winner]: state.score[winner] + 1 };
    return {
      ...state,
      pending: fill(state.players, ""),
      rounds: [...state.rounds, { choices: pending, winner }],
      score,
      winner: winner !== "" && score[winner] >= state.winsNeeded ? winner : "",
    };
  },

  getOutcome(state) {
    return state.winner === ""
      ? { status: GAME_STATUS.ONGOING }
      : {
          status: GAME_STATUS.FINISHED,
          result: "win",
          winners: [state.winner],
          reason: `best-of-${state.bestOf}`,
        };
  },

  /** You see your own choice for this round. For anyone else you only see that they have chosen. */
  viewFor(state, viewer) {
    return {
      bestOf: state.bestOf,
      score: { ...state.score },
      round: state.rounds.length + 1,
      rounds: state.rounds,
      hasChosen: Object.fromEntries(state.players.map((p) => [p, state.pending[p] !== ""])),
      yourChoice: state.players.includes(viewer) ? state.pending[viewer] : "",
    };
  },

  activePlayers(state) {
    return state.winner === "" ? state.players.filter((p) => state.pending[p] === "") : [];
  },
});
