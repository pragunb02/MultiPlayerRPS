/**
 * @typedef {Object} GameInfo
 * @property {string} id          stable identifier used in events, the API and the database. It is never shown.
 * @property {string} slug        readable, stable URL segment (`/games/tic-tac-toe`), never reused for another game
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
    {
      id: GAME_IDS.RPS,
      slug: "rock-paper-scissors",
      name: "Rock Paper Scissors",
      minPlayers: 2,
      maxPlayers: 2,
    },
    { id: GAME_IDS.TIC_TAC_TOE, slug: "tic-tac-toe", name: "Tic Tac Toe", minPlayers: 2, maxPlayers: 2 },
    { id: GAME_IDS.CHESS, slug: "chess", name: "Chess", minPlayers: 2, maxPlayers: 2 },
  ].map((game) => Object.freeze(game)),
);

/**
 * @param {string} id
 * @returns {Readonly<GameInfo> | undefined}
 */
export function getGame(id) {
  return GAMES.find((game) => game.id === id);
}

/**
 * @param {string} slug
 * @returns {Readonly<GameInfo> | undefined}
 */
export function getGameBySlug(slug) {
  return GAMES.find((game) => game.slug === slug);
}

/**
 * Why an engine refused a move. Clients switch on these to explain the refusal.
 */
export const MOVE_REJECTIONS = Object.freeze({
  NOT_A_PLAYER: "NOT_A_PLAYER",
  NOT_YOUR_TURN: "NOT_YOUR_TURN",
  INVALID_MOVE: "INVALID_MOVE",
  ILLEGAL_MOVE: "ILLEGAL_MOVE",
  GAME_OVER: "GAME_OVER",
});

/** Lifecycle of a single game, as reported by an engine. */
export const GAME_STATUS = Object.freeze({
  ONGOING: "ongoing",
  FINISHED: "finished",
});
