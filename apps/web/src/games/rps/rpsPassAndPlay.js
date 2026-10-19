import { RPS_CHOICES } from "@classicade/shared";
import { nameOf } from "../roomView.js";

const CHOICE_NAMES = Object.freeze({
  [RPS_CHOICES.ROCK]: "Rock",
  [RPS_CHOICES.PAPER]: "Paper",
  [RPS_CHOICES.SCISSORS]: "Scissors",
});

/**
 * What the "pass the phone" screen says about the round just played, in pass and play (CC-223). Both players see it
 * while the phone changes hands, so they learn how the round went before the next choice is covered. Empty before
 * the first round. Only finished rounds are named, never a choice still secret.
 *
 * @param {any} room  the RoomView of a Rock Paper Scissors game
 * @returns {string}
 */
export function rpsHandOverNote(room) {
  const { rounds, score } = room.game.view;
  const last = rounds.at(-1);
  if (last === undefined) return "";
  const played = room.seats
    .map((seat) => `${seat.displayName} played ${CHOICE_NAMES[last.choices[seat.playerId]]}`)
    .join(", ");
  const verdict =
    last.winner === ""
      ? "A draw, so the round is played again."
      : `${nameOf(room, last.winner)} won the round.`;
  const standing = room.seats.map((seat) => `${seat.displayName} ${score[seat.playerId]}`).join(", ");
  return `Round ${rounds.length}: ${played}. ${verdict} Score: ${standing}.`;
}
