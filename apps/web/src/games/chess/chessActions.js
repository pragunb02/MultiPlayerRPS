import { CHESS_ACTIONS, CHESS_REQUEST_TYPES } from "@classicade/shared";
import { outgoingRequests } from "../roomUpdates.js";

const RESIGN = Object.freeze({
  control: "chess.resign",
  label: "Resign",
  reason: "",
  intent: Object.freeze({ type: "move", move: Object.freeze({ type: CHESS_ACTIONS.RESIGN }) }),
  variant: "ghost",
  confirm: Object.freeze({
    title: "Resign this game?",
    body: "Your opponent will win the game.",
    confirmLabel: "Resign",
    keepLabel: "Keep playing",
  }),
});

/**
 * Chess's buttons in the match's action bar (CC-157): Offer draw and Resign. Neither waits for your turn. A draw
 * offer is a room request (CC-159), so a standing one is answered or withdrawn in the request banner, and the
 * shell says why the button waits meanwhile. Resigning asks first, in the shell's dialog.
 *
 * @param {any} room  RoomView of a chess game that is on, seen by a seated player
 * @returns {ReadonlyArray<import("../../components/MatchShell/matchShell.js").GameAction>}
 */
export function chessActions(room) {
  const offered = outgoingRequests(room).some((request) => request.type === CHESS_REQUEST_TYPES.DRAW);
  return Object.freeze([
    Object.freeze({
      control: "chess.offer_draw",
      label: offered ? "Draw offered" : "Offer draw",
      reason: "",
      intent: Object.freeze({ type: "ask", requestType: CHESS_REQUEST_TYPES.DRAW }),
      variant: "secondary",
    }),
    RESIGN,
  ]);
}
