/**
 * @typedef {Object} GameInfo
 * @property {string} id          stable identifier used in URLs, events and the database
 * @property {string} name        display name
 * @property {number} minPlayers
 * @property {number} maxPlayers
 */

export const GAME_IDS = Object.freeze({
  RPS: "rps",
  TIC_TAC_TOE: "tictactoe",
  CHESS: "chess",
});

/** @type {ReadonlyArray<Readonly<GameInfo>>} */
export const GAMES = Object.freeze(
  [
    { id: GAME_IDS.RPS, name: "Rock Paper Scissors", minPlayers: 2, maxPlayers: 2 },
    { id: GAME_IDS.TIC_TAC_TOE, name: "Tic Tac Toe", minPlayers: 2, maxPlayers: 2 },
    { id: GAME_IDS.CHESS, name: "Chess", minPlayers: 2, maxPlayers: 2 },
  ].map((game) => Object.freeze(game)),
);

/**
 * @param {string} id
 * @returns {Readonly<GameInfo> | undefined}
 */
export function getGame(id) {
  return GAMES.find((game) => game.id === id);
}
