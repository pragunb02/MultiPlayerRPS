import { ROOM_END_REASONS } from "@classicade/shared";
import { gameView } from "./registry.js";
import { nameOf } from "./roomView.js";

/**
 * The room's own ways to end a game, for every game (CC-036): a player left or stayed disconnected (forfeit), or
 * did not move in time (idle). Worded to follow "You won", "You lost" or "Draw".
 */
const ROOM_PHRASES = Object.freeze({
  [ROOM_END_REASONS.FORFEIT]: "by forfeit",
  [ROOM_END_REASONS.IDLE]: "on the move timer",
});

/** How the game ended, worded to follow "You won" or "Draw". Empty when nothing more is known. */
function reasonPhrase(room) {
  const { reason } = room.game.outcome;
  return ROOM_PHRASES[reason] ?? (gameView(room.gameId).reasonPhrase ?? (() => ""))(reason);
}

/** Whether a finished game was aborted because someone never made a first move: it counts for nothing (CC-036). */
export const isAborted = (room) => room.game.outcome.result === ROOM_END_REASONS.ABORTED;

/**
 * The result headline of a finished game, from the viewer's point of view, with how it ended (CC-162): "You won
 * by checkmate", "You lost on time", "Draw by agreement", "Bob won by forfeit". Each game words its own reasons
 * through the client game registry. A reason nobody knows leaves the plain result, such as "You won!". A game
 * aborted before its first moves says so, because there is no winner.
 *
 * @param {any} room  a finished RoomView
 */
export function resultHeadline(room) {
  const { outcome } = room.game;
  if (isAborted(room)) {
    return "Game aborted: the first move did not come in time";
  }
  const phrase = reasonPhrase(room);
  const ending = phrase === "" ? "" : ` ${phrase}`;
  if (outcome.result === "draw") {
    return phrase === "" ? "It's a draw" : `Draw${ending}`;
  }
  if (room.you === "") {
    return `${nameOf(room, outcome.winners[0])} won${ending}`;
  }
  if (outcome.winners.includes(room.you)) {
    return phrase === "" ? "You won!" : `You won${ending}`;
  }
  return `You lost${ending}`;
}
