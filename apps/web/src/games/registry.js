import { GAME_IDS } from "@classicade/shared";
import { CHESS_REQUEST_TEXTS, chessReasonPhrase, chessSounds } from "./chess/chessAlerts.js";
import { ChessOptions } from "./chess/ChessOptions.jsx";
import { CHESS_HOW_TO_PLAY, RPS_HOW_TO_PLAY, TICTACTOE_HOW_TO_PLAY } from "./howToPlay.js";
import { lazyBoard } from "./lazyBoard.js";
import { rpsReasonPhrase, rpsSounds } from "./rps/rpsAlerts.js";
import { RpsOptions } from "./rps/RpsOptions.jsx";
import { tictactoeReasonPhrase, tictactoeSounds } from "./tictactoe/tictactoeAlerts.js";

// Boards load on demand: a player only downloads the game they open (chess brings chess.js).
const RpsBoard = lazyBoard(() => import("./rps/RpsBoard.jsx"), "RpsBoard");
const TicTacToeBoard = lazyBoard(() => import("./tictactoe/TicTacToeBoard.jsx"), "TicTacToeBoard");
const ChessBoard = lazyBoard(() => import("./chess/ChessBoard.jsx"), "ChessBoard");

/**
 * @typedef {Object} GameViewEntry
 * @property {import("react").ComponentType<any>} [Options]  the form for the game's options in the lobby
 * @property {import("react").ComponentType<any>} [Board]    the board in a room
 * @property {(previous: any, next: any, you: string) => string[]} [soundsFor]  the sounds a change of the game
 *   makes, as ids from SOUNDS (CC-103)
 * @property {Readonly<Record<string, import("./roomUpdates.js").RequestTexts>>} [requestTexts]  the words for
 *   the requests a player of this game can send the other during play, such as a draw offer (CC-159)
 * @property {(reason: string) => string} [reasonPhrase]  how a game ended, worded to follow "You won" or "Draw"
 *   in the result headline, such as "by checkmate" (CC-162)
 * @property {ReadonlyArray<import("./howToPlay.js").HowToPlayStep>} [howToPlay]  the lobby's three short steps
 *   for a first-time player (CC-259)
 */

/**
 * Client-side plug-in point, mirroring the server's engine registry: each game contributes an options form, a
 * board, and what its updates sound like and ask. Rooms and pages never switch on game ids.
 *
 * @type {Readonly<Record<string, Readonly<GameViewEntry>>>}
 */
export const GAME_VIEWS = Object.freeze({
  [GAME_IDS.RPS]: Object.freeze({
    Options: RpsOptions,
    Board: RpsBoard,
    soundsFor: rpsSounds,
    reasonPhrase: rpsReasonPhrase,
    howToPlay: RPS_HOW_TO_PLAY,
  }),
  [GAME_IDS.TIC_TAC_TOE]: Object.freeze({
    Board: TicTacToeBoard,
    soundsFor: tictactoeSounds,
    reasonPhrase: tictactoeReasonPhrase,
    howToPlay: TICTACTOE_HOW_TO_PLAY,
  }),
  [GAME_IDS.CHESS]: Object.freeze({
    Options: ChessOptions,
    Board: ChessBoard,
    soundsFor: chessSounds,
    requestTexts: CHESS_REQUEST_TEXTS,
    reasonPhrase: chessReasonPhrase,
    howToPlay: CHESS_HOW_TO_PLAY,
  }),
});

/**
 * @param {string} gameId
 * @returns {Readonly<GameViewEntry>} an empty entry for a game the web app has nothing for yet
 */
export const gameView = (gameId) => GAME_VIEWS[gameId] ?? Object.freeze({});
