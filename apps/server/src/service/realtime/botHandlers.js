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
 *   networkOf: (address: string) => import("../../utils/networkKey.js").NetworkNames,
 *   now: () => number,
 *   logger: import("../../utils/logger.js").Logger,
 * }} deps  `networkOf` names the socket's address when the game is created, as for any new room
 */
export function createBotHandlers({ socket, botComponent, roomComponent, networkOf, now, logger }) {
  const identity = socket.data.identity;

  return {
    async [SOCKET_EVENTS.ROOM_PLAY_COMPUTER](payload) {
      const { gameId, options, level } = parsePlayComputer(payload);
      const network = networkOf(socket.data.address);
      const room = await botComponent.playComputer({
        host: identity,
        network: network.name,
        earlierNetworks: network.earlier,
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
