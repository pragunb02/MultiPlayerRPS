import { GAME_IDS } from "@classicade/shared";
import { ChessOptions } from "./chess/ChessOptions.jsx";
import { RpsOptions } from "./rps/RpsOptions.jsx";

/**
 * Client-side plug-in point, mirroring the server's engine registry: each game contributes an options form and
 * a board (boards arrive in CC-024). Rooms and pages never switch on game ids.
 *
 * @type {Readonly<Record<string, { Options?: import("react").ComponentType<any>, Board?: import("react").ComponentType<any> }>>}
 */
export const GAME_VIEWS = Object.freeze({
  [GAME_IDS.RPS]: Object.freeze({ Options: RpsOptions }),
  [GAME_IDS.TIC_TAC_TOE]: Object.freeze({}),
  [GAME_IDS.CHESS]: Object.freeze({ Options: ChessOptions }),
});

/** @param {string} gameId */
export const gameView = (gameId) => GAME_VIEWS[gameId] ?? Object.freeze({});
