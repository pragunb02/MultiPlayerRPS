import { ROOM_STATUS } from "@classicade/shared";

/**
 * Small readers of a RoomView (SOCKET_EVENTS) shared by the boards, sounds and popups.
 */

/** A seated player's display name, or "Someone" for an id that has no seat (any more). */
export const nameOf = (room, playerId) =>
  room.seats.find((seat) => seat.playerId === playerId)?.displayName ?? "Someone";

/** Everyone seated except the viewer, by name: "Bob", or "Bob and Carol". */
export const opponentsOf = (room) =>
  room.seats
    .filter((seat) => seat.playerId !== room.you)
    .map((seat) => seat.displayName)
    .join(" and ");

/** Whether the viewer may act in the game right now. */
export const isYourTurn = (room) =>
  room.you !== "" && room.status === ROOM_STATUS.PLAYING && room.game.activePlayers.includes(room.you);

/**
 * Which game of the room this is: 0 for the first, and each rematch adds one. It is the same while a game is
 * played and after it finished, so it tells a rematch apart from the game before it.
 */
export function gameNumber(room) {
  if (room.series === undefined) return 0;
  return room.series.games - (room.status === ROOM_STATUS.FINISHED ? 1 : 0);
}
