import { BOT_CHARACTERS } from "@classicade/shared";

/**
 * Readers for computer characters in a RoomView (CC-138, ADR-025). A seat with `bot` is a computer player, and the
 * app always says so next to its name.
 */

/** The seats of the room's computer players, usually none or one. */
export const computerSeats = (room) => room.seats.filter((seat) => seat.bot !== undefined);

/** Whether a seat is a computer player. */
export const isComputer = (seat) => seat?.bot !== undefined;

/**
 * The level a computer player plays at, in the words of the level picker, such as "Unbeatable". A level this build
 * does not know yet keeps its id, so the label is still there.
 *
 * @param {{ bot: { character: string, level: string } }} seat
 */
export function levelNameOf(seat) {
  const character = BOT_CHARACTERS.find((entry) => entry.id === seat.bot.character);
  return character?.levels.find((level) => level.id === seat.bot.level)?.name ?? seat.bot.level;
}
