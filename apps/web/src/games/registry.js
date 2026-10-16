import { lazy } from "react";
import { GAME_IDS } from "@classicade/shared";
import { ChessOptions } from "./chess/ChessOptions.jsx";
import { RpsOptions } from "./rps/RpsOptions.jsx";

// Boards load on demand: a player only downloads the game they open (chess brings chess.js).
const RpsBoard = lazy(() => import("./rps/RpsBoard.jsx").then((m) => ({ default: m.RpsBoard })));
const TicTacToeBoard = lazy(() =>
  import("./tictactoe/TicTacToeBoard.jsx").then((m) => ({ default: m.TicTacToeBoard })),
);
const ChessBoard = lazy(() => import("./chess/ChessBoard.jsx").then((m) => ({ default: m.ChessBoard })));

/**
 * Client-side plug-in point, mirroring the server's engine registry: each game contributes an options form and
 * a board. Rooms and pages never switch on game ids.
 *
 * @type {Readonly<Record<string, { Options?: import("react").ComponentType<any>, Board?: import("react").ComponentType<any> }>>}
 */
export const GAME_VIEWS = Object.freeze({
  [GAME_IDS.RPS]: Object.freeze({ Options: RpsOptions, Board: RpsBoard }),
  [GAME_IDS.TIC_TAC_TOE]: Object.freeze({ Board: TicTacToeBoard }),
  [GAME_IDS.CHESS]: Object.freeze({ Options: ChessOptions, Board: ChessBoard }),
});

/** @param {string} gameId */
export const gameView = (gameId) => GAME_VIEWS[gameId] ?? Object.freeze({});
