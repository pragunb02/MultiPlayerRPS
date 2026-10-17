import { Chess } from "chess.js";
import { CHESS_END_REASONS as END, CHESS_TIME_CONTROLS } from "@classicade/shared";

/**
 * Pure chess helpers for the board: geometry, history replay, material and PGN. The server decides every rule
 * and result. These only describe what it sent, so they can be tested without rendering anything.
 */

export const FILES = Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h"]);
export const PIECE_NAMES = Object.freeze({
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
});
export const PROMOTION_PIECES = Object.freeze(["q", "n", "r", "b"]);
export const colourName = (colour) => (colour === "w" ? "white" : "black");
export const opposite = (colour) => (colour === "w" ? "b" : "w");
export const pieceImage = (colour, type) => `/pieces/${colour}${type.toUpperCase()}.png`;

const PIECE_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });
const START_COUNTS = Object.freeze({ p: 8, n: 2, b: 2, r: 2, q: 1 });
const CAPTURABLE = Object.freeze(["p", "n", "b", "r", "q"]);

/** The 64 squares in screen order (top row first) for a player sitting on the `orientation` side. */
export function boardRows(orientation) {
  const ranks = orientation === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === "w" ? FILES : [...FILES].reverse();
  return ranks.map((rank) => files.map((file) => `${file}${rank}`));
}

export const isDarkSquare = (square) => (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 1;

/** Steps in (file, rank) for each arrow key as seen from White's side. Black's view mirrors both. */
const ARROW_STEPS = Object.freeze({
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
});

/** The neighbouring square on screen in the direction of an arrow key. At the edge the square stays the same. */
function squareInDirection(square, key, orientation) {
  const sign = orientation === "w" ? 1 : -1;
  const [df, dr] = ARROW_STEPS[key];
  const file = FILES.indexOf(square[0]) + df * sign;
  const rank = Number(square[1]) + dr * sign;
  return file < 0 || file > 7 || rank < 1 || rank > 8 ? square : `${FILES[file]}${rank}`;
}

/**
 * Where the board's keyboard cursor goes for a key, as the grid pattern for screen readers sets out. An arrow moves
 * one square on screen and stops at the edge. Home and End go to the first and last square of the row on screen.
 * With Ctrl (Cmd on a Mac) they go to the top left and bottom right squares of the board. Any other key answers
 * an empty string, so the key keeps its usual job.
 *
 * @param {{ square: string, key: string, ctrl: boolean, orientation: "w" | "b" }} input  `ctrl` is true while Ctrl
 *   or Cmd is held down
 * @returns {string}
 */
export function squareForKey({ square, key, ctrl, orientation }) {
  if (Object.hasOwn(ARROW_STEPS, key)) {
    return squareInDirection(square, key, orientation);
  }
  if (key !== "Home" && key !== "End") {
    return "";
  }
  const rows = boardRows(orientation);
  const row = ctrl ? rows[key === "Home" ? 0 : 7] : rows.find((squares) => squares.includes(square));
  return key === "Home" ? row[0] : row[7];
}

/**
 * The square under a point on screen, given where the board is drawn, or "" when the point is off the board.
 *
 * @param {{ rect: { left: number, top: number, width: number, height: number }, x: number, y: number, orientation: "w" | "b" }} input
 */
export function squareAtPoint({ rect, x, y, orientation }) {
  const column = Math.floor(((x - rect.left) / rect.width) * 8);
  const row = Math.floor(((y - rect.top) / rect.height) * 8);
  // Written so that a board with no size yet (NaN) also counts as off the board.
  if (!(column >= 0 && column <= 7 && row >= 0 && row <= 7)) {
    return "";
  }
  return boardRows(orientation)[row][column];
}

/** Screen offset in squares from one square to another, for sliding a piece between them. */
export function squareOffset({ from, to, orientation }) {
  const sign = orientation === "w" ? 1 : -1;
  return {
    x: (FILES.indexOf(from[0]) - FILES.indexOf(to[0])) * sign,
    y: (Number(to[1]) - Number(from[1])) * sign,
  };
}

/**
 * @typedef {{ fen: string, from: string, to: string, san: string, flags: string }} Position
 * One position of the game and the move that led to it (empty strings for the starting position).
 */

function tryMove(chess, move) {
  try {
    return chess.move(move);
  } catch {
    return undefined;
  }
}

const positionAfter = (move) => ({
  fen: move.after,
  from: move.from,
  to: move.to,
  san: move.san,
  flags: move.flags,
});

/**
 * Replays the game from the start. The server sends the moves in chess notation (SAN, like Nf3), and
 * replaying them gives every earlier position for looking back and for the PGN. A move that does not replay
 * (it never should) ends the replay there, so a bad entry can only shorten the history, never break the board.
 *
 * @param {ReadonlyArray<string>} sans
 * @returns {{ positions: Position[], chess: Chess }}
 */
export function replayGame(sans) {
  const chess = new Chess();
  const positions = [{ fen: chess.fen(), from: "", to: "", san: "", flags: "" }];
  for (const san of sans) {
    const move = tryMove(chess, san);
    if (move === undefined) {
      break;
    }
    positions.push(positionAfter(move));
  }
  return { positions, chess };
}

/** The position after a move the player just made, shown before the server confirms it. */
export function positionWithMove(fen, move) {
  return positionAfter(new Chess(fen).move(move));
}

/** Where the rook goes when a move castles (the king's move is the move itself), or undefined for other moves. */
export function castlingRook({ to, flags }) {
  const rank = to[1];
  if (flags.includes("k")) return { from: `h${rank}`, to: `f${rank}` };
  if (flags.includes("q")) return { from: `a${rank}`, to: `d${rank}` };
  return undefined;
}

/**
 * Pieces each side has taken (in the usual order: pawns first) and who is ahead on material. Pawns that were
 * promoted are not counted as taken: the extra queen on the board stands for them.
 *
 * @param {string} fen
 * @returns {{ captured: Record<"w" | "b", string[]>, advantage: Record<"w" | "b", number> }}
 */
export function materialBalance(fen) {
  const pieces = new Chess(fen)
    .board()
    .flat()
    .filter((piece) => piece !== null);
  const count = (colour, type) => pieces.filter((p) => p.color === colour && p.type === type).length;
  const taken = (colour, type) => {
    if (type !== "p") {
      return Math.max(0, START_COUNTS[type] - count(colour, type));
    }
    const promoted = ["n", "b", "r", "q"].reduce(
      (sum, t) => sum + Math.max(0, count(colour, t) - START_COUNTS[t]),
      0,
    );
    return Math.max(0, START_COUNTS.p - count(colour, "p") - promoted);
  };
  // What `capturer` took is what the other side is missing.
  const capturedBy = (capturer) =>
    CAPTURABLE.flatMap((type) => Array(taken(opposite(capturer), type)).fill(type));
  const score = (colour) =>
    pieces.filter((p) => p.color === colour).reduce((sum, p) => sum + PIECE_VALUES[p.type], 0);
  const lead = score("w") - score("b");
  return {
    captured: { w: capturedBy("w"), b: capturedBy("b") },
    advantage: { w: Math.max(0, lead), b: Math.max(0, -lead) },
  };
}

/** "2 pawns, 1 knight" for a list of piece letters. */
export function describePieces(types) {
  return CAPTURABLE.filter((type) => types.includes(type))
    .map((type) => {
      const n = types.filter((t) => t === type).length;
      return `${n} ${PIECE_NAMES[type]}${n > 1 ? "s" : ""}`;
    })
    .join(", ");
}

const END_TEXT = Object.freeze({
  [END.CHECKMATE]: "Checkmate",
  [END.STALEMATE]: "Stalemate",
  [END.INSUFFICIENT_MATERIAL]: "Insufficient material",
  [END.THREEFOLD_REPETITION]: "Threefold repetition",
  [END.FIFTY_MOVE_RULE]: "Fifty-move rule",
  [END.RESIGNATION]: "Resignation",
  [END.AGREEMENT]: "Draw by agreement",
  [END.TIMEOUT]: "Time out",
  [END.TIMEOUT_VS_INSUFFICIENT_MATERIAL]: "Time out with too little material to win",
  // A room level reason: the player who left the room forfeits.
  forfeit: "Opponent left",
});

/** Why the game ended, in words. Unknown reasons (from a newer server) still read sensibly. */
export const endReasonText = (reason) => END_TEXT[reason] ?? "Game over";

/**
 * The PGN result token for an outcome, from the colours the players had.
 *
 * @param {{ result?: string, winners?: string[] } | undefined} outcome  undefined or ongoing while the game is on
 * @param {Record<string, "w" | "b">} colors
 */
export function resultToken(outcome, colors) {
  if (outcome?.result === "draw") return "1/2-1/2";
  if (outcome?.result !== "win") return "*";
  return colors[outcome.winners[0]] === "w" ? "1-0" : "0-1";
}

const pgnDate = (ms) => new Date(ms).toISOString().slice(0, 10).replaceAll("-", ".");

/**
 * The game as PGN (Portable Game Notation), the text format every chess program reads.
 *
 * @param {{ moves: ReadonlyArray<string>, white: string, black: string, result: string, reason: string,
 *   timeControl: string, date: number, site: string }} game  `date` in ms, `reason` "" while the game is on
 */
export function buildPgn({ moves, white, black, result, reason, timeControl, date, site }) {
  const { chess } = replayGame(moves);
  const control = CHESS_TIME_CONTROLS[timeControl];
  chess.setHeader("Event", "ClassiCade casual game");
  chess.setHeader("Site", site);
  chess.setHeader("Date", pgnDate(date));
  chess.setHeader("White", white);
  chess.setHeader("Black", black);
  chess.setHeader("Result", result);
  chess.setHeader(
    "TimeControl",
    control === undefined ? "-" : `${control.initialSeconds}+${control.incrementSeconds}`,
  );
  if (reason !== "") {
    chess.setHeader("Termination", endReasonText(reason));
  }
  return `${chess.pgn({ maxWidth: 80 })}\n`;
}

/** A file name for the download: classicade-<room>-<date>.pgn */
export const pgnFileName = ({ code, date }) => `classicade-${code}-${pgnDate(date).replaceAll(".", "-")}.pgn`;
