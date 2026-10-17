import { SOCKET_EVENTS } from "@classicade/shared";
import { parsePlayComputer } from "./payloads.js";
import { roomChannel, stampedView } from "./roomHandlers.js";

/**
 * Socket handlers for games against a computer character (CC-138, CC-221). The player's identity comes from the
 * session and the character's from the server, so nobody can sit in a computer player's seat.
 *
 * @param {{
 *   socket: import("socket.io").Socket,
 *   botComponent: ReturnType<typeof import("../../domain/bots/botComponent.js").createBotComponent>,
 *   roomComponent: ReturnType<typeof import("../../domain/rooms/roomComponent.js").createRoomComponent>,
 *   now: () => number,
 *   logger: import("../../utils/logger.js").Logger,
 * }} deps
 */
export function createBotHandlers({ socket, botComponent, roomComponent, now, logger }) {
  const identity = socket.data.identity;

  return {
    async [SOCKET_EVENTS.ROOM_PLAY_COMPUTER](payload) {
      const { gameId, options, level } = parsePlayComputer(payload);
      const room = await botComponent.playComputer({
        host: identity,
        network: socket.data.network,
        gameId,
        options,
        level,
        now: now(),
      });
      socket.join(roomChannel(room.code));
      logger.info({ roomCode: room.code, gameId, level }, "game against the computer started");
      return stampedView({ roomComponent, room, viewerId: identity.id, now });
    },
  };
}
