import { GAME_IDS, GAME_STATUS, MOVE_REJECTIONS, TTT_CELLS, TTT_MARKS } from "@classicade/shared";
import { defineEngine } from "../engine.js";
import { ok, reject } from "../result.js";
import { randomIndex } from "../rng.js";

/** The eight ways to make three in a row. */
export const WINNING_LINES = Object.freeze(
  [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ].map((line) => Object.freeze(line)),
);

/**
 * @typedef {Object} TicTacToeState
 * @property {[string, string]} players
 * @property {Record<string, "X" | "O">} marks   the starter plays X
 * @property {string[]} board                    9 cells: "", "X" or "O"
 * @property {string} turn                       player to move ("" once finished)
 * @property {string} winner                     "" unless someone made three in a row
 * @property {number[]} winningLine              the completed line, [] otherwise
 */

/** @returns {number[]} the first completed line on the board, or [] */
const findWinningLine = (board) => [
  ...(WINNING_LINES.find(([a, b, c]) => board[a] !== "" && board[a] === board[b] && board[a] === board[c]) ??
    []),
];

const isFinished = (state) => state.winner !== "" || state.board.every((cell) => cell !== "");

/**
 * Classic 3×3 Tic-Tac-Toe. The server decides every result: one move produces exactly one outcome,
 * even when it completes two lines at once.
 */
export const tictactoeEngine = defineEngine({
  id: GAME_IDS.TIC_TAC_TOE,
  players: { min: 2, max: 2 },

  validateOptions(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length > 0) {
      return reject(MOVE_REJECTIONS.INVALID_MOVE, "Tic-Tac-Toe has no options");
    }
    return ok({});
  },

  /** @returns {TicTacToeState} */
  init({ players, rng }) {
    const starter = players[randomIndex(rng, players.length)];
    const other = players.find((p) => p !== starter);
    return {
      players: [players[0], players[1]],
      marks: { [starter]: TTT_MARKS.X, [other]: TTT_MARKS.O },
      board: Array(TTT_CELLS).fill(""),
      turn: starter,
      winner: "",
      winningLine: [],
    };
  },

  validateMove(state, playerId, raw) {
    if (!state.players.includes(playerId)) {
      return reject(MOVE_REJECTIONS.NOT_A_PLAYER, "You are not in this game");
    }
    if (isFinished(state)) {
      return reject(MOVE_REJECTIONS.GAME_OVER, "The game is over");
    }
    if (state.turn !== playerId) {
      return reject(MOVE_REJECTIONS.NOT_YOUR_TURN, "Wait for your turn");
    }
    const cell = raw?.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell >= TTT_CELLS) {
      return reject(MOVE_REJECTIONS.INVALID_MOVE, "Pick a cell from 0 to 8");
    }
    if (state.board[cell] !== "") {
      return reject(MOVE_REJECTIONS.ILLEGAL_MOVE, "That cell is taken");
    }
    return ok({ cell });
  },

  applyMove(state, playerId, { cell }) {
    const board = state.board.map((value, index) => (index === cell ? state.marks[playerId] : value));
    const winningLine = findWinningLine(board);
    const winner = winningLine.length > 0 ? playerId : "";
    const next = { ...state, board, winner, winningLine };
    return { ...next, turn: isFinished(next) ? "" : state.players.find((p) => p !== playerId) };
  },

  getOutcome(state) {
    if (state.winner !== "") {
      return {
        status: GAME_STATUS.FINISHED,
        result: "win",
        winners: [state.winner],
        reason: "three-in-a-row",
      };
    }
    if (isFinished(state)) {
      return { status: GAME_STATUS.FINISHED, result: "draw", winners: [], reason: "board-full" };
    }
    return { status: GAME_STATUS.ONGOING };
  },

  /** No hidden information: everyone sees the same board. */
  viewFor(state) {
    return { board: state.board, marks: state.marks, turn: state.turn, winningLine: state.winningLine };
  },

  activePlayers(state) {
    return state.turn === "" ? [] : [state.turn];
  },
});
