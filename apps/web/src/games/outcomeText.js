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

/**
 * How the game ended, worded to follow "You won" or "Draw", or "You lost" when the viewer lost. A game may word a
 * loss its own way (`lostPhrase`, CC-163). Empty when nothing more is known.
 */
function reasonPhrase(room, lost) {
  const { reason } = room.game.outcome;
  if (Object.hasOwn(ROOM_PHRASES, reason)) {
    return ROOM_PHRASES[reason];
  }
  const view = gameView(room.gameId);
  const lostPhrase = lost ? view.outcomeText?.words(reason)?.lostPhrase : undefined;
  return lostPhrase ?? (view.reasonPhrase ?? (() => ""))(reason);
}

/** Whether a finished game was aborted because someone never made a first move: it counts for nothing (CC-036). */
export const isAborted = (room) => room.game.outcome.result === ROOM_END_REASONS.ABORTED;

/**
 * The result headline of a finished game, from the viewer's point of view, with how it ended (CC-162): "You won
 * by checkmate", "You lost on time", "Draw by agreement", "Bob won by forfeit". Each game words its own reasons
 * through the client game registry. A reason nobody knows leaves the plain result, such as "You won!". A game
 * aborted before its first moves says only that, and the outcome moment's line says why (CC-163).
 *
 * @param {any} room  a finished RoomView
 */
export function resultHeadline(room) {
  const { outcome } = room.game;
  if (isAborted(room)) {
    return "Game aborted";
  }
  const lost = room.you !== "" && outcome.result !== "draw" && !outcome.winners.includes(room.you);
  const phrase = reasonPhrase(room, lost);
  const ending = phrase === "" ? "" : ` ${phrase}`;
  if (outcome.result === "draw") {
    return phrase === "" ? "It's a draw" : `Draw${ending}`;
  }
  if (room.you === "") {
    return `${nameOf(room, outcome.winners[0])} won${ending}`;
  }
  if (!lost) {
    return phrase === "" ? "You won!" : `You won${ending}`;
  }
  return `You lost${ending}`;
}
