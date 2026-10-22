import { GAME_IDS } from "@classicade/shared";
import { chessActions } from "./chess/chessActions.js";
import {
  CHESS_OUTCOME_TEXT,
  CHESS_REQUEST_TEXTS,
  chessReasonPhrase,
  chessSounds,
} from "./chess/chessAlerts.js";
import { ChessOptions } from "./chess/ChessOptions.jsx";
import { chessTurnLabel } from "./chess/chessPassAndPlay.js";
import { lazyBoard, lazyEngine } from "./lazyBoard.js";
import { RPS_OUTCOME_TEXT, rpsReasonPhrase, rpsSounds } from "./rps/rpsAlerts.js";
import { rpsHandOverNote } from "./rps/rpsPassAndPlay.js";
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

// How to play loads with the pages that show it (a lobby, an invite, a match), not with the first page, because the
// registry is in the first download for the request banners (CC-349).
const howToPlayOf = (gameId) => () => import("./howToPlay.js").then((module) => module.howToPlayFor(gameId));

// The engines for pass and play load the same way, only when two people start a game on one phone (CC-223).
const RPS_PASS_AND_PLAY = Object.freeze({
  loadEngine: lazyEngine(() => import("@classicade/games/rps"), "rpsEngine"),
  handOver: true,
  handOverNote: rpsHandOverNote,
});
const TICTACTOE_PASS_AND_PLAY = Object.freeze({
  loadEngine: lazyEngine(() => import("@classicade/games/tictactoe"), "tictactoeEngine"),
  handOver: false,
});
const CHESS_PASS_AND_PLAY = Object.freeze({
  loadEngine: lazyEngine(() => import("@classicade/games/chess"), "chessEngine"),
  handOver: false,
  turnLabel: chessTurnLabel,
});

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
 * @property {() => Promise<ReadonlyArray<import("./howToPlay.js").HowToPlayStep>>} [loadHowToPlay]  the game's
 *   How to play, 1 to 3 short steps for a first-time player (CC-259, CC-349), loaded on demand. The pages draw them
 *   from `games/howToPlay.js`, which only the pages that show them import
 * @property {(room: any) => ReadonlyArray<import("../components/MatchShell/matchShell.js").GameAction>} [actions]
 *   the game's buttons in the action bar while a seated player plays, at most three (Leave takes the fourth place)
 * @property {(room: any) => { text: string } | undefined} [inGameScore]  the score inside one game, such as the
 *   rounds of a best-of-3, for the match bar. Undefined when there is none yet
 * @property {import("react").ComponentType<{ room: any }>} [Panel]  the game's side panel, such as a move list,
 *   under the players in the side column
 * @property {PassAndPlay} [passAndPlay]  how two people play the game on one phone (CC-223). A game without it has
 *   no pass and play
 */

/**
 * What a game brings to pass and play (CC-223).
 *
 * @typedef {Object} PassAndPlay
 * @property {() => Promise<Readonly<import("@classicade/games").GameEngine<any, any, any>>>} loadEngine  the game's
 *   pure engine, loaded on demand like the board, so a game never downloads another game's rules
 * @property {boolean} handOver  whether a move stays secret until both have moved, as in Rock Paper Scissors. Then
 *   a "pass the phone" screen covers the board whenever the phone must go to the other player
 * @property {(room: any) => string} [handOverNote]  what that screen says about the last turn, which both players
 *   may see, such as how the last round went. "" when there is nothing to say
 * @property {(room: any) => string} [turnLabel]  whose turn it is in the match bar, such as "Asha (White) to move".
 *   Without it the bar says "Asha's turn"
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
    loadHowToPlay: howToPlayOf(GAME_IDS.RPS),
    passAndPlay: RPS_PASS_AND_PLAY,
  }),
  [GAME_IDS.TIC_TAC_TOE]: Object.freeze({
    Board: TicTacToeBoard,
    soundsFor: tictactoeSounds,
    reasonPhrase: tictactoeReasonPhrase,
    outcomeText: TICTACTOE_OUTCOME_TEXT,
    loadHowToPlay: howToPlayOf(GAME_IDS.TIC_TAC_TOE),
    passAndPlay: TICTACTOE_PASS_AND_PLAY,
  }),
  [GAME_IDS.CHESS]: Object.freeze({
    Options: ChessOptions,
    Board: ChessBoard,
    soundsFor: chessSounds,
    requestTexts: CHESS_REQUEST_TEXTS,
    reasonPhrase: chessReasonPhrase,
    outcomeText: CHESS_OUTCOME_TEXT,
    loadHowToPlay: howToPlayOf(GAME_IDS.CHESS),
    actions: chessActions,
    passAndPlay: CHESS_PASS_AND_PLAY,
  }),
});

/**
 * @param {string} gameId
 * @returns {Readonly<GameViewEntry>} an empty entry for a game the web app has nothing for yet
 */
export const gameView = (gameId) => GAME_VIEWS[gameId] ?? Object.freeze({});
