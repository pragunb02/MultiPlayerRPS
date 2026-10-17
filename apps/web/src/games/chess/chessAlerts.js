import { CHESS_ACTIONS, CHESS_DRAW_ANSWERS, CHESS_END_REASONS as END, ROOM_STATUS } from "@classicade/shared";
import { SOUNDS } from "../../lib/sound/sounds.js";
import { nameOf, opponentsOf } from "../roomView.js";

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
 * A standing draw offer, as a request the other player answers (CC-104). An offer stays the same request through
 * the offerer's own moves, so the opponent is not alerted twice for one offer.
 *
 * @param {any} room  RoomView
 * @returns {import("../roomUpdates.js").RoomRequest[]}
 */
export function chessRequests(room) {
  const by = room.game.view.drawOfferBy;
  if (room.status !== ROOM_STATUS.PLAYING || by === "") {
    return [];
  }
  return [
    {
      key: `draw:${by}`,
      from: by,
      title: "Draw offer",
      question: (name) => `${name} offers a draw.`,
      waitingTitle: "Draw offered",
      showWaiting: true,
      accept: { type: "move", move: { type: CHESS_ACTIONS.ACCEPT_DRAW } },
      decline: { type: "move", move: { type: CHESS_ACTIONS.DECLINE_DRAW } },
      cancel: { type: "move", move: { type: CHESS_ACTIONS.WITHDRAW_DRAW } },
    },
  ];
}

/**
 * What the other side should be told when a draw offer ends without a draw (CC-104): the offerer hears that it
 * was declined (also when the opponent simply moved), the opponent hears that it was withdrawn. Whoever ended the
 * offer is not told about their own action.
 *
 * @param {any} previous  RoomView before the update
 * @param {any} next      RoomView after it
 * @param {string} you    the viewer ("" for spectators)
 * @returns {string[]}
 */
export function chessNotices(previous, next, you) {
  const offeredBy = previous.game.view.drawOfferBy;
  const { drawOfferBy, drawAnswer } = next.game.view;
  if (you === "" || next.status !== ROOM_STATUS.PLAYING || offeredBy === "" || drawOfferBy !== "") {
    return [];
  }
  if (drawAnswer === CHESS_DRAW_ANSWERS.DECLINED && offeredBy === you) {
    return [`${opponentsOf(next)} declined your draw offer`];
  }
  if (drawAnswer === CHESS_DRAW_ANSWERS.WITHDRAWN && offeredBy !== you) {
    return [`${nameOf(next, offeredBy)} withdrew the draw offer`];
  }
  return [];
}

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
