import { CHESS_END_REASONS as END, CHESS_REQUEST_TYPES } from "@classicade/shared";
import { SOUNDS } from "../../lib/sound/sounds.js";

/**
 * The sound a chess move makes, read from its notation: a check ("+") is announced over everything else, then
 * castling ("O-O", "O-O-O"), then a capture ("x"). A checkmate ("#") sounds like the move that gave it, and the
 * result sound follows.
 *
 * @param {string} san  the move in standard algebraic notation, such as "Nxe5+"
 */
export function soundForSan(san) {
  if (san.includes("+")) return SOUNDS.CHECK;
  if (san.startsWith("O-O")) return SOUNDS.CASTLE;
  if (san.includes("x")) return SOUNDS.CAPTURE;
  return SOUNDS.MOVE;
}

/**
 * Chess sounds between two views of the same game (CC-103): the newest move's sound when a move was made.
 *
 * @param {any} previous  RoomView before the update
 * @param {any} next      RoomView after it
 * @returns {string[]}
 */
export function chessSounds(previous, next) {
  const moves = next.game.view.moves;
  return moves.length > previous.game.view.moves.length ? [soundForSan(moves.at(-1))] : [];
}

/**
 * The words of the chess requests (CC-159): a draw offer, which the room keeps like every other request. Moving
 * instead of answering declines it, so the offerer hears "declined" then as well.
 *
 * @type {Readonly<Record<string, import("../roomUpdates.js").RequestTexts>>}
 */
export const CHESS_REQUEST_TEXTS = Object.freeze({
  [CHESS_REQUEST_TYPES.DRAW]: Object.freeze({
    title: "Draw offer",
    waitingTitle: "Draw offered",
    question: (name) => `${name} offers a draw.`,
    waiting: (name) => `Draw offered. Waiting for ${name} to answer`,
    declined: (name) => `${name} declined your draw offer`,
    withdrawn: (name) => `${name} withdrew the draw offer`,
    accepted: (name) => `${name} accepted the draw`,
    site: (game) => `offers a draw at ${game}`,
  }),
});

const REASON_PHRASES = Object.freeze({
  [END.CHECKMATE]: "by checkmate",
  [END.STALEMATE]: "by stalemate",
  [END.INSUFFICIENT_MATERIAL]: "by insufficient material",
  [END.THREEFOLD_REPETITION]: "by threefold repetition",
  [END.FIFTY_MOVE_RULE]: "by the fifty-move rule",
  [END.RESIGNATION]: "by resignation",
  [END.AGREEMENT]: "by agreement",
  [END.TIMEOUT]: "on time",
  [END.TIMEOUT_VS_INSUFFICIENT_MATERIAL]: "on time with too little material to win",
});

/**
 * How a chess game ended, as the end of the result headline (CC-162): "You won by checkmate", "You lost on time",
 * "Draw by agreement". Empty for a reason this version does not know, so the headline still reads well.
 *
 * @param {string} reason  the outcome's reason (CHESS_END_REASONS)
 */
export const chessReasonPhrase = (reason) => REASON_PHRASES[reason] ?? "";
