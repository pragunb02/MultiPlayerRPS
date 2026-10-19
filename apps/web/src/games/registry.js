import { GAME_IDS } from "@classicade/shared";
import { chessActions } from "./chess/chessActions.js";
import {
  CHESS_OUTCOME_TEXT,
  CHESS_REQUEST_TEXTS,
  chessReasonPhrase,
  chessSounds,
} from "./chess/chessAlerts.js";
import { ChessOptions } from "./chess/ChessOptions.jsx";
import { CHESS_HOW_TO_PLAY, RPS_HOW_TO_PLAY, TICTACTOE_HOW_TO_PLAY } from "./howToPlay.js";
import { lazyBoard } from "./lazyBoard.js";
import { RPS_OUTCOME_TEXT, rpsReasonPhrase, rpsSounds } from "./rps/rpsAlerts.js";
import { RpsOptions } from "./rps/RpsOptions.jsx";
import {
  TICTACTOE_OUTCOME_TEXT,
  tictactoeReasonPhrase,
  tictactoeSounds,
} from "./tictactoe/tictactoeAlerts.js";

// Boards load on demand: a player only downloads the game they open (chess brings chess.js).
const RpsBoard = lazyBoard(() => import("./rps/RpsBoard.jsx"), "RpsBoard");
const TicTacToeBoard = lazyBoard(() => import("./tictactoe/TicTacToeBoard.jsx"), "TicTacToeBoard");
const ChessBoard = lazyBoard(() => import("./chess/ChessBoard.jsx"), "ChessBoard");

/**
 * What a game brings to the web app. Every field is optional: a game with only a `Board` plays in the match shell
 * like any other, and each field it adds fills one more part of the frame (CC-157, ADR-049).
 *
 * @typedef {Object} GameViewEntry
 * @property {import("react").ComponentType<any>} [Options]  the form for the game's options in the lobby
 * @property {import("react").ComponentType<BoardProps>} [Board]  the board, on the match shell's stage
 * @property {(previous: any, next: any, you: string) => string[]} [soundsFor]  the sounds a change of the game
 *   makes, as ids from SOUNDS (CC-103)
 * @property {Readonly<Record<string, import("./roomUpdates.js").RequestTexts>>} [requestTexts]  the words for
 *   the requests a player of this game can send the other during play, such as a draw offer (CC-159)
 * @property {(reason: string) => string} [reasonPhrase]  how a game ended, worded to follow "You won" or "Draw"
 *   in the result headline, such as "by checkmate" (CC-162)
 * @property {import("./outcomeLine.js").OutcomeText} [outcomeText]  the words of the game's endings in the
 *   outcome moment, and a computer character's tip after a loss (CC-163). Without it the moment uses plain words
 * @property {ReadonlyArray<import("./howToPlay.js").HowToPlayStep>} [howToPlay]  the lobby's three short steps
 *   for a first-time player (CC-259)
 * @property {(room: any) => ReadonlyArray<import("../components/MatchShell/matchShell.js").GameAction>} [actions]
 *   the game's buttons in the action bar while a seated player plays, at most three (Leave takes the fourth place)
 * @property {(room: any) => { text: string } | undefined} [inGameScore]  the score inside one game, such as the
 *   rounds of a best-of-3, for the match bar. Undefined when there is none yet
 * @property {import("react").ComponentType<{ room: any }>} [Panel]  the game's side panel, such as a move list,
 *   under the players in the side column
 */

/**
 * What the shell gives a board: the RoomView, the calls that send a move or a request, and why the viewer cannot
 * play now ("" when they can, see playReason).
 *
 * @typedef {{
 *   room: any,
 *   onMove: (move: object) => Promise<unknown>,
 *   onAsk: (type: string) => Promise<unknown>,
 *   reason: string,
 * }} BoardProps
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
    outcomeText: RPS_OUTCOME_TEXT,
    howToPlay: RPS_HOW_TO_PLAY,
  }),
  [GAME_IDS.TIC_TAC_TOE]: Object.freeze({
    Board: TicTacToeBoard,
    soundsFor: tictactoeSounds,
    reasonPhrase: tictactoeReasonPhrase,
    outcomeText: TICTACTOE_OUTCOME_TEXT,
    howToPlay: TICTACTOE_HOW_TO_PLAY,
  }),
  [GAME_IDS.CHESS]: Object.freeze({
    Options: ChessOptions,
    Board: ChessBoard,
    soundsFor: chessSounds,
    requestTexts: CHESS_REQUEST_TEXTS,
    reasonPhrase: chessReasonPhrase,
    outcomeText: CHESS_OUTCOME_TEXT,
    howToPlay: CHESS_HOW_TO_PLAY,
    actions: chessActions,
  }),
});

/**
 * @param {string} gameId
 * @returns {Readonly<GameViewEntry>} an empty entry for a game the web app has nothing for yet
 */
export const gameView = (gameId) => GAME_VIEWS[gameId] ?? Object.freeze({});
