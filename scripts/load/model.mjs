// How a simulated player behaves in the load test (CC-289). Every number here is an assumption written down in
// docs/tickets/CC-289.md, research section 2.2, because there are no real players to copy yet.
import { Chess } from "chess.js";

import { randomIndex } from "../../packages/games/src/rng.js";
import { BOT_CHARACTERS, GAME_IDS, RPS_CHOICES } from "../../packages/shared/src/index.js";

/**
 * @typedef {{ min: number, max: number }} Span   milliseconds, or a count, drawn evenly between the two
 *
 * @typedef {Object} PlayerModel
 * @property {Record<string, number>} gameShare       share of players per game id, adding up to 1
 * @property {number} computerShare                   share of players who play a computer character
 * @property {Record<string, Span>} thinkMs           pause before each move, per game id
 * @property {Span} resultMs                          pause on the result before a rematch or a new room
 * @property {number} rematchShare                    share of finished games followed by a rematch
 * @property {Span} chessOwnMoves                     a chess player resigns after this many of their own moves
 * @property {number} rpsBestOf
 * @property {string} chessTimeControl
 */

/** The model of research section 2.2. A run may change any of it. */
export const DEFAULT_MODEL = Object.freeze({
  gameShare: Object.freeze({ [GAME_IDS.RPS]: 0.4, [GAME_IDS.TIC_TAC_TOE]: 0.3, [GAME_IDS.CHESS]: 0.3 }),
  computerShare: 0.4,
  thinkMs: Object.freeze({
    [GAME_IDS.RPS]: Object.freeze({ min: 1_000, max: 4_000 }),
    [GAME_IDS.TIC_TAC_TOE]: Object.freeze({ min: 1_000, max: 3_000 }),
    [GAME_IDS.CHESS]: Object.freeze({ min: 2_000, max: 10_000 }),
  }),
  resultMs: Object.freeze({ min: 2_000, max: 5_000 }),
  rematchShare: 0.6,
  chessOwnMoves: Object.freeze({ min: 20, max: 60 }),
  rpsBestOf: 3,
  chessTimeControl: "blitz-5+0",
});

/**
 * A whole number or a time drawn evenly from a span, both ends included.
 *
 * @param {import("../../packages/games/src/rng.js").Rng} rng
 * @param {Span} span
 * @returns {number}
 */
export function draw(rng, { min, max }) {
  return min + randomIndex(rng, max - min + 1);
}

/**
 * Picks what a new player plays: a game by its share, and whether against a computer character, with one of its
 * levels chosen evenly.
 *
 * @param {import("../../packages/games/src/rng.js").Rng} rng
 * @param {PlayerModel} model
 * @returns {{ gameId: string, computer: boolean, level: string }}   `level` is "" for a game between people
 */
export function pickPlan(rng, model) {
  const roll = rng();
  const entries = Object.entries(model.gameShare);
  let sum = 0;
  // The last game takes whatever the shares leave, so rounding never picks nothing.
  const found = entries.find(([, share]) => {
    sum += share;
    return roll < sum;
  });
  const gameId = (found ?? entries.at(-1))[0];
  // A game between people seats two players and a computer game one, so a share of players becomes a larger
  // share of the games started: with 40 % of players, 57 % of the games started are computer games.
  const computer = rng() < (2 * model.computerShare) / (1 + model.computerShare);
  if (!computer) {
    return { gameId, computer, level: "" };
  }
  const { levels } = BOT_CHARACTERS.find((character) => character.gameId === gameId);
  return { gameId, computer, level: levels[randomIndex(rng, levels.length)].id };
}

/**
 * The options a new room of this game is opened with.
 *
 * @param {string} gameId
 * @param {PlayerModel} model
 * @returns {Record<string, unknown>}
 */
export function roomOptions(gameId, model) {
  if (gameId === GAME_IDS.RPS) return { bestOf: model.rpsBestOf };
  if (gameId === GAME_IDS.CHESS) return { timeControl: model.chessTimeControl };
  return {};
}

const THROWS = Object.values(RPS_CHOICES);

/**
 * The move a player sends when it is their turn, chosen at random among the legal ones. A chess player who has
 * made enough moves resigns instead, so games end at a human length (research section 2.2, point 2).
 *
 * @param {{ gameId: string, game: { view: any }, rng: import("../../packages/games/src/rng.js").Rng, resign: boolean }} input
 * @returns {Record<string, unknown>}
 */
export function chooseMove({ gameId, game, rng, resign }) {
  if (gameId === GAME_IDS.RPS) {
    return { choice: THROWS[randomIndex(rng, THROWS.length)] };
  }
  if (gameId === GAME_IDS.TIC_TAC_TOE) {
    const empty = game.view.board.flatMap((mark, cell) => (mark === "" ? [cell] : []));
    return { cell: empty[randomIndex(rng, empty.length)] };
  }
  if (resign) {
    return { type: "resign" };
  }
  const legal = new Chess(game.view.fen).moves({ verbose: true });
  const { from, to, promotion } = legal[randomIndex(rng, legal.length)];
  return promotion === undefined ? { type: "move", from, to } : { type: "move", from, to, promotion: "q" };
}
