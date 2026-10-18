import { Chess } from "chess.js";
import {
  CHESS_ACTIONS,
  CHESS_END_REASONS as END,
  CHESS_PROMOTIONS,
  CHESS_REQUEST_TYPES,
  CHESS_TIME_CONTROLS,
  DEFAULT_CHESS_TIME_CONTROL,
  GAME_IDS,
  GAME_STATUS,
  MOVE_REJECTIONS,
} from "@classicade/shared";
import { defineEngine } from "../engine.js";
import { ok, reject } from "../result.js";
import { randomIndex } from "../rng.js";

const SQUARE = /^[a-h][1-8]$/;
const ACTIONS = new Set(Object.values(CHESS_ACTIONS));
/** Internal move type: a move that arrived after the mover's clock ran out (loses on time). */
const FLAG = "flag";

/**
 * @typedef {"w" | "b"} Color
 *
 * @typedef {Object} ChessState
 * @property {[string, string]} players
 * @property {Record<string, Color>} colors
 * @property {Record<Color, string>} byColor
 * @property {string} timeControl
 * @property {number} incrementMs
 * @property {Record<Color, number>} clocks       remaining ms per side, as of `lastMoveAt`
 * @property {number} lastMoveAt                  time of the last move, or 0 before White's first move (the clocks start then)
 * @property {Array<{ from: string, to: string, san: string, at: number, promotion?: string }>} moves
 * @property {string} fen                         current position, so a move never needs the game replayed
 * @property {string[]} positions                 position keys since the last capture or pawn move, current one last
 * @property {{ reason: string, winner: string }} end   reason is "" while the game is on. winner is "" for a draw.
 */

const opposite = (color) => (color === "w" ? "b" : "w");
const sideToMove = (state) => /** @type {Color} */ (state.fen.split(" ")[1]);
const isOver = (state) => state.end.reason !== "";
const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * The half move clock in a FEN. It goes back to 0 on every capture and pawn move. No position from before such a
 * move can ever come back, so the repetition history only needs the positions since then.
 */
const halfMoveClock = (fen) => Number(fen.split(" ")[4]);

/**
 * Position keys of a game replayed from its moves. The key is chess.js's own position hash, the same one it counts
 * for threefold repetition, so the result matches what a full replay would decide.
 */
function positionsFromMoves(moves) {
  const chess = new Chess();
  let positions = [chess.hash()];
  for (const { from, to, promotion } of moves) {
    chess.move(promotion ? { from, to, promotion } : { from, to });
    positions = halfMoveClock(chess.fen()) === 0 ? [chess.hash()] : [...positions, chess.hash()];
  }
  return positions;
}

/**
 * The positions since the last capture or pawn move. A game stored before they were kept has none. A game that an
 * older version of the server went on playing after a rollback has a list that no longer fits the board: it ends on
 * another position, or it is shorter than the half move clock says. Either way the list is rebuilt once from the
 * moves, after which every move carries it forward (CC-180).
 *
 * @param {ChessState} state
 * @param {string} current   the key of the position on the board now
 */
function positionsOf(state, current) {
  const kept = state.positions;
  const fits = kept?.at(-1) === current && kept.length === halfMoveClock(state.fen) + 1;
  return fits ? kept : positionsFromMoves(state.moves);
}

/**
 * Whether `color` still has mating material (approximation used by most servers): anything beyond a lone
 * king or king + one minor piece. Decides whether running out of time loses or draws (FIDE 6.9).
 */
function hasMatingMaterial(fen, color) {
  const pieces = new Chess(fen)
    .board()
    .flat()
    .filter((square) => square !== null && square.color === color && square.type !== "k")
    .map((square) => square.type);
  return pieces.some((type) => type === "p" || type === "r" || type === "q") || pieces.length >= 2;
}

/** When the side to move runs out of time: 0 before White's first move (clocks not running) and after the end. */
const deadline = (state) =>
  isOver(state) || state.lastMoveAt === 0 ? 0 : state.lastMoveAt + state.clocks[sideToMove(state)];

/** The side to move has run out of time. */
function timeout(state, loser) {
  const winner = opposite(loser);
  const end = hasMatingMaterial(state.fen, winner)
    ? { reason: END.TIMEOUT, winner: state.byColor[winner] }
    : { reason: END.TIMEOUT_VS_INSUFFICIENT_MATERIAL, winner: "" };
  return { ...state, clocks: { ...state.clocks, [loser]: 0 }, end };
}

/** Result of the position after a move, if the board itself ends the game. */
function boardEnd(chess, mover, positions) {
  const key = chess.hash();
  if (chess.isCheckmate()) return { reason: END.CHECKMATE, winner: mover };
  if (chess.isStalemate()) return { reason: END.STALEMATE, winner: "" };
  if (chess.isInsufficientMaterial()) return { reason: END.INSUFFICIENT_MATERIAL, winner: "" };
  if (positions.filter((seen) => seen === key).length >= 3) {
    return { reason: END.THREEFOLD_REPETITION, winner: "" };
  }
  if (chess.isDrawByFiftyMoves()) return { reason: END.FIFTY_MOVE_RULE, winner: "" };
  return { reason: "", winner: "" };
}

function validateBoardMove(state, raw) {
  const { from, to, promotion } = raw;
  if (!SQUARE.test(String(from)) || !SQUARE.test(String(to))) {
    return reject(MOVE_REJECTIONS.INVALID_MOVE, "Moves need squares like e2 and e4");
  }
  if (promotion !== undefined && !CHESS_PROMOTIONS.includes(promotion)) {
    return reject(MOVE_REJECTIONS.INVALID_MOVE, "Promote to q, r, b or n");
  }
  const chess = new Chess(state.fen);
  try {
    chess.move(promotion === undefined ? { from, to } : { from, to, promotion });
  } catch {
    const needsPromotion = chess
      .moves({ square: from, verbose: true })
      .some((m) => m.to === to && m.promotion);
    return needsPromotion && promotion === undefined
      ? reject(MOVE_REJECTIONS.INVALID_MOVE, "Choose a piece to promote to")
      : reject(MOVE_REJECTIONS.ILLEGAL_MOVE, "That move is not legal");
  }
  return ok(
    promotion === undefined
      ? { type: CHESS_ACTIONS.MOVE, from, to }
      : { type: CHESS_ACTIONS.MOVE, from, to, promotion },
  );
}

/**
 * How long a draw offer stays open, and how often one player may offer a draw in one game (CC-159). Thirty seconds
 * is enough to think about an offer without the clock, which keeps running, deciding it.
 */
const DRAW_OFFER = Object.freeze({ lifetimeMs: 30_000, limitPerPlayer: 3 });

/**
 * Chess with server-side clocks. The rules of the board come from chess.js. Clocks and resignation are handled
 * here. Running out of time is detected both when a late move arrives and via the `deadline` hook, so a player
 * who stops moving still loses on time. A draw offer is a room request, and accepting it ends the game here.
 */
export const chessEngine = defineEngine({
  id: GAME_IDS.CHESS,
  players: { min: 2, max: 2 },

  validateOptions(raw) {
    if (!isPlainObject(raw) || Object.keys(raw).some((key) => key !== "timeControl")) {
      return reject(MOVE_REJECTIONS.INVALID_MOVE, "Chess options: { timeControl }");
    }
    const timeControl = raw.timeControl ?? DEFAULT_CHESS_TIME_CONTROL;
    if (!Object.hasOwn(CHESS_TIME_CONTROLS, timeControl)) {
      return reject(
        MOVE_REJECTIONS.INVALID_MOVE,
        `timeControl must be one of ${Object.keys(CHESS_TIME_CONTROLS).join(", ")}`,
      );
    }
    return ok({ timeControl });
  },

  /** @returns {ChessState} */
  init({ players, options, rng }) {
    const white = players[randomIndex(rng, players.length)];
    const black = players.find((p) => p !== white);
    const board = new Chess();
    const { initialSeconds, incrementSeconds } = CHESS_TIME_CONTROLS[options.timeControl];
    return {
      players: [players[0], players[1]],
      colors: { [white]: "w", [black]: "b" },
      byColor: { w: white, b: black },
      timeControl: options.timeControl,
      incrementMs: incrementSeconds * 1000,
      clocks: { w: initialSeconds * 1000, b: initialSeconds * 1000 },
      lastMoveAt: 0,
      moves: [],
      fen: board.fen(),
      positions: [board.hash()],
      end: { reason: "", winner: "" },
    };
  },

  validateMove(state, playerId, raw, { now }) {
    if (!state.players.includes(playerId)) {
      return reject(MOVE_REJECTIONS.NOT_A_PLAYER, "You are not in this game");
    }
    if (isOver(state)) {
      return reject(MOVE_REJECTIONS.GAME_OVER, "The game is over");
    }
    if (!isPlainObject(raw) || !ACTIONS.has(raw.type)) {
      return reject(MOVE_REJECTIONS.INVALID_MOVE, `Send { type: ${[...ACTIONS].join(" | ")} }`);
    }
    switch (raw.type) {
      case CHESS_ACTIONS.RESIGN:
        return ok({ type: CHESS_ACTIONS.RESIGN });
      default: {
        const color = state.colors[playerId];
        if (sideToMove(state) !== color) {
          return reject(MOVE_REJECTIONS.NOT_YOUR_TURN, "Wait for your turn");
        }
        if (state.lastMoveAt > 0 && now - state.lastMoveAt >= state.clocks[color]) {
          return ok({ type: FLAG });
        }
        return validateBoardMove(state, raw);
      }
    }
  },

  applyMove(state, playerId, move, { now }) {
    const opponent = state.players.find((p) => p !== playerId);
    switch (move.type) {
      case CHESS_ACTIONS.RESIGN:
        return { ...state, end: { reason: END.RESIGNATION, winner: opponent } };
      case FLAG:
        return timeout(state, state.colors[playerId]);
      default: {
        const color = state.colors[playerId];
        const played = move.promotion
          ? { from: move.from, to: move.to, promotion: move.promotion }
          : { from: move.from, to: move.to };
        const chess = new Chess(state.fen);
        const current = chess.hash();
        const { san } = chess.move(played);
        const fen = chess.fen();
        const positions =
          halfMoveClock(fen) === 0 ? [chess.hash()] : [...positionsOf(state, current), chess.hash()];
        const remaining =
          state.lastMoveAt > 0
            ? state.clocks[color] - (now - state.lastMoveAt) + state.incrementMs
            : state.clocks[color];
        return {
          ...state,
          clocks: { ...state.clocks, [color]: remaining },
          lastMoveAt: now,
          moves: [...state.moves, { ...played, san, at: now }],
          fen,
          positions,
          end: boardEnd(chess, playerId, positions),
        };
      }
    }
  },

  getOutcome(state) {
    if (!isOver(state)) {
      return { status: GAME_STATUS.ONGOING };
    }
    return state.end.winner === ""
      ? { status: GAME_STATUS.FINISHED, result: "draw", winners: [], reason: state.end.reason }
      : {
          status: GAME_STATUS.FINISHED,
          result: "win",
          winners: [state.end.winner],
          reason: state.end.reason,
        };
  },

  /** Nothing is secret in chess. Clients run the visible clock from `clocks`, `lastMoveAt` and `toMove`. */
  viewFor(state) {
    const last = state.moves.at(-1);
    return {
      fen: state.fen,
      moves: state.moves.map(({ san }) => san),
      lastMove: last === undefined ? {} : { from: last.from, to: last.to },
      colors: state.colors,
      toMove: isOver(state) ? "" : state.byColor[sideToMove(state)],
      inCheck: new Chess(state.fen).inCheck(),
      timeControl: state.timeControl,
      clocks: state.clocks,
      lastMoveAt: state.lastMoveAt,
    };
  },

  activePlayers(state) {
    return isOver(state) ? [] : [state.byColor[sideToMove(state)]];
  },

  deadline,

  requestTypes: { [CHESS_REQUEST_TYPES.DRAW]: DRAW_OFFER },

  /** The only request is a draw offer: the opponent accepting it ends the game in a draw by agreement. */
  acceptRequest: (state) =>
    isOver(state) ? state : { ...state, end: { reason: END.AGREEMENT, winner: "" } },

  expire(state, { now }) {
    const due = deadline(state);
    return due > 0 && now >= due ? timeout(state, sideToMove(state)) : state;
  },
});
