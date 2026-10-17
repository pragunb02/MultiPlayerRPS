import { SOUNDS } from "../../lib/sound/sounds.js";

const filled = (room) => room.game.view.board.filter((cell) => cell !== "").length;

/**
 * Tic-Tac-Toe sounds between two views of the same game (CC-103): a pop when a mark lands, and a flourish when a
 * line is completed.
 *
 * @param {any} previous  RoomView before the update
 * @param {any} next      RoomView after it
 * @returns {string[]}
 */
export function tictactoeSounds(previous, next) {
  const placed = filled(next) > filled(previous) ? [SOUNDS.PLACE] : [];
  const lined = previous.game.view.winningLine.length === 0 && next.game.view.winningLine.length > 0;
  return lined ? [...placed, SOUNDS.LINE] : placed;
}
