import { ROOM_STATUS } from "@classicade/shared";
import { SOUNDS } from "../../lib/sound/sounds.js";

/**
 * Rock Paper Scissors sounds between two views of the same game (CC-103): the hands opening when a round is
 * revealed, then whether you won or lost that round. On the last round the match result sound says it instead,
 * so only the reveal plays. Spectators and drawn rounds hear just the reveal.
 *
 * @param {any} previous  RoomView before the update
 * @param {any} next      RoomView after it
 * @param {string} you    the viewer ("" for spectators)
 * @returns {string[]}
 */
export function rpsSounds(previous, next, you) {
  const { rounds } = next.game.view;
  if (rounds.length <= previous.game.view.rounds.length) {
    return [];
  }
  const { winner } = rounds.at(-1);
  if (you === "" || winner === "" || next.status !== ROOM_STATUS.PLAYING) {
    return [SOUNDS.REVEAL];
  }
  return [SOUNDS.REVEAL, winner === you ? SOUNDS.ROUND_WON : SOUNDS.ROUND_LOST];
}
