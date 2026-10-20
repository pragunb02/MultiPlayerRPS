import { SOCKET_EVENTS } from "@classicade/shared";
import { ForbiddenError, GoneError, NotFoundError } from "../../utils/errors.js";
import { parseRoomRef } from "./payloads.js";
import { roomChannel } from "./roomHandlers.js";

/**
 * @typedef {Pick<ReturnType<typeof import("../../domain/rooms/roomComponent.js").createRoomComponent>, "getRoom">} RoomsForRatings
 */

/**
 * The ratings as a room is told them: each one names its player by their seat's place in the room (0 for the first
 * seat), in seat order, the way blocks name a seat. Never by player id, which room views no longer show (CC-253,
 * ADR-057). A player who has left their seat since is left out.
 *
 * @param {{ room: { seats: ReadonlyArray<{ playerId: string }> }, ratings: ReadonlyArray<{ playerId: string }> }} input
 * @returns {Array<{ seat: number, rating: number, deviation: number, games: number, provisional: boolean, change?: number }>}
 */
export function seatRatings({ room, ratings }) {
  const byPlayer = new Map(ratings.map(({ playerId, ...rating }) => [playerId, rating]));
  return room.seats.flatMap(({ playerId }, seat) =>
    byPlayer.has(playerId) ? [{ seat, ...byPlayer.get(playerId) }] : [],
  );
}

/**
 * Socket handlers for chess ratings (CC-042, ADR-062). A tab asks for the ratings of the room it has open, and
 * only of that room: the server reads who sits there, so no rating is ever looked up by an id the client sends.
 *
 * @param {{
 *   socket: import("socket.io").Socket,
 *   roomComponent: RoomsForRatings,
 *   chessRatingComponent: Pick<ReturnType<typeof import("../../domain/ratings/chessRatingComponent.js").createChessRatingComponent>, "ratingsOf">,
 * }} deps
 */
export function createRatingHandlers({ socket, roomComponent, chessRatingComponent }) {
  return {
    async [SOCKET_EVENTS.RATING_ROOM](payload) {
      const { code } = parseRoomRef(payload);
      // The tab joined the room through `room:join` or by creating it, where the room's own rules were checked.
      if (!socket.rooms.has(roomChannel(code))) {
        throw new ForbiddenError("Open the room to see its ratings");
      }
      const room = await roomComponent.getRoom(code);
      const ratings = await chessRatingComponent.ratingsOf({
        gameId: room.gameId,
        playerIds: room.seats.map((seat) => seat.playerId),
        matchId: room.game?.matchId ?? "",
      });
      return { ratings: seatRatings({ room, ratings }) };
    },
  };
}

/** The room while it is still open, or none once it has closed. */
async function openRoom(roomComponent, code) {
  try {
    return [await roomComponent.getRoom(code)];
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof GoneError) return [];
    throw err;
  }
}

/**
 * Tells everyone with the room open what a rated game did to the ratings (CC-042), by seat. A room that has
 * closed since has nobody to tell. Any other failure is logged, because the push is extra information and the
 * ratings are stored already: the room's page asks for them again when the game ends and with its next game.
 *
 * @param {{
 *   io: import("socket.io").Server,
 *   roomComponent: RoomsForRatings,
 *   logger: Pick<import("../../utils/logger.js").Logger, "error">,
 *   update: { roomCode: string, matchId: string, ratings: ReadonlyArray<{ playerId: string }> },
 * }} input
 * @returns {Promise<void>} never rejects
 */
export async function pushRoomRatings({ io, roomComponent, logger, update: { roomCode, matchId, ratings } }) {
  try {
    for (const room of await openRoom(roomComponent, roomCode)) {
      io.to(roomChannel(roomCode)).emit(SOCKET_EVENTS.RATING_UPDATED, {
        matchId,
        ratings: seatRatings({ room, ratings }),
      });
    }
  } catch (err) {
    logger.error({ err, roomCode }, "failed to push the chess ratings");
  }
}
