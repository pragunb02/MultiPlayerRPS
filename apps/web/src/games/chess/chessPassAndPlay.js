import { nameOf } from "../roomView.js";

const COLOUR_NAMES = Object.freeze({ w: "White", b: "Black" });

/**
 * Whose move it is in chess on one phone, with their colour, such as "Asha (White) to move" (CC-223). Both players
 * look at the same screen, so the match bar names the player and the side instead of saying "Your turn".
 *
 * @param {any} room  the RoomView of a chess game that is on
 * @returns {string}
 */
export function chessTurnLabel(room) {
  const mover = room.game.activePlayers[0];
  return `${nameOf(room, mover)} (${COLOUR_NAMES[room.game.view.colors[mover]]}) to move`;
}
