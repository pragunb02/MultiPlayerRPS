import { gameView } from "./registry.js";
import { nameOf } from "./roomView.js";

/** The room's own way to end a game, for every game: a player left while it was on, so they forfeit. */
const FORFEIT = "forfeit";

/** How the game ended, worded to follow "You won" or "Draw". Empty when nothing more is known. */
function reasonPhrase(room) {
  const { reason } = room.game.outcome;
  if (reason === FORFEIT) {
    return "by forfeit";
  }
  return (gameView(room.gameId).reasonPhrase ?? (() => ""))(reason);
}

/**
 * The result headline of a finished game, from the viewer's point of view, with how it ended (CC-162): "You won
 * by checkmate", "You lost on time", "Draw by agreement", "Bob won by forfeit". Each game words its own reasons
 * through the client game registry. A reason nobody knows leaves the plain result, such as "You won!".
 *
 * @param {any} room  a finished RoomView
 */
export function resultHeadline(room) {
  const { outcome } = room.game;
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
