import { SOCKET_EVENTS } from "@classicade/shared";
import { ForbiddenError } from "../../utils/errors.js";
import { parseRoomRef } from "./payloads.js";
import { roomChannel } from "./roomHandlers.js";

/**
 * Socket handlers for chess ratings (CC-042, ADR-062). A tab asks for the ratings of the room it has open, and
 * only of that room: the server reads who sits there, so no rating is ever looked up by an id the client sends.
 *
 * @param {{
 *   socket: import("socket.io").Socket,
 *   roomComponent: Pick<ReturnType<typeof import("../../domain/rooms/roomComponent.js").createRoomComponent>, "getRoom">,
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
      return { ratings };
    },
  };
}
