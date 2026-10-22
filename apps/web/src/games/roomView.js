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
 * Where the match stands for the viewer: "waiting" for an opponent, "my-turn", "their-turn", "finished", or
 * "watching" for a spectator. The room page writes it on the page, so tests and telemetry know the state.
 *
 * @returns {"waiting" | "my-turn" | "their-turn" | "finished" | "watching"}
 */
export function matchPhase(room) {
  if (room.you === "") return "watching";
  if (room.status === ROOM_STATUS.WAITING) return "waiting";
  if (room.status === ROOM_STATUS.FINISHED) return "finished";
  return isYourTurn(room) ? "my-turn" : "their-turn";
}

/** The reasons a board can be closed to the viewer, in their words (CC-164). */
export const PLAY_REASONS = Object.freeze({
  // Says the game waits too, so a player who lost the connection knows their turn is not lost (CL-37).
  RECONNECTING: "Reconnecting. Your move can wait.",
  WATCHING: "You are watching this game",
  WAITING: "Waiting for an opponent to join",
  OVER: "The game is over",
  NOT_YOUR_TURN: "Not your turn",
});

/**
 * Why the viewer cannot play on the board right now, in their words (CC-164). Empty when they can. A board adds
 * its own reasons on top, such as a cell that is taken.
 *
 * @param {any} room  RoomView
 * @param {{ reconnecting: boolean }} connection  whether the connection to the server is being restored
 */
export function playReason(room, { reconnecting }) {
  if (reconnecting) return PLAY_REASONS.RECONNECTING;
  const phase = matchPhase(room);
  if (phase === "watching") return PLAY_REASONS.WATCHING;
  if (phase === "waiting") return PLAY_REASONS.WAITING;
  if (phase === "finished") return PLAY_REASONS.OVER;
  if (phase === "their-turn") return PLAY_REASONS.NOT_YOUR_TURN;
  return "";
}

/**
 * Which game of the room this is: 1 for the first, and each rematch adds one, as the server counts them. It is the
 * same while a game is played and after it finished, so it tells a rematch apart from the game before it. 0 while
 * the room waits for its first game.
 */
export const gameNumber = (room) => room.game?.number ?? 0;

/** The viewer's seat in the room, or undefined for a spectator. */
export const seatOf = (room, playerId) => room.seats.find((seat) => seat.playerId === playerId);
