import { SOCKET_EVENTS } from "@classicade/shared";
import { ForbiddenError, GoneError, NotFoundError } from "../../utils/errors.js";
import { parseCreateRoom, parseGameMove, parseRoomRef } from "./payloads.js";

export const roomChannel = (code) => `room:${code}`;
const codeFromChannel = (channel) => channel.slice("room:".length);

/**
 * A viewer's room view, stamped with the server's clock so clients can show timers (e.g. chess clocks) in
 * server time regardless of their own clock's drift. `revision` counts the room's saved changes, so a client can
 * tell an answer that arrives late from a newer update that overtook it: a computer player may move before the
 * answer to the move it replies to has left the server (CC-138).
 */
export const stampedView = ({ roomComponent, room, viewerId, now }) => ({
  ...roomComponent.viewFor(room, viewerId),
  revision: room.version,
  serverTime: now(),
});

/**
 * Sends every socket in the room its own view (hidden information stays hidden per viewer).
 *
 * @param {{ io: import("socket.io").Server, roomComponent: any, room: any, now: () => number, exceptSocketId?: string }} args
 */
export async function broadcastRoom({ io, roomComponent, room, now, exceptSocketId }) {
  const sockets = await io.in(roomChannel(room.code)).fetchSockets();
  for (const socket of sockets) {
    if (socket.id !== exceptSocketId) {
      socket.emit(
        SOCKET_EVENTS.ROOM_UPDATED,
        stampedView({ roomComponent, room, viewerId: socket.data.identity.id, now }),
      );
    }
  }
}

/** All sockets of one player that are in a room channel (a player may have several tabs open). */
async function playerSockets(io, code, playerId) {
  const sockets = await io.in(roomChannel(code)).fetchSockets();
  return sockets.filter((socket) => socket.data.identity.id === playerId);
}

/**
 * Socket handlers for rooms and moves. Identity always comes from `socket.data.identity` (the session);
 * payloads are validated at the edge, rules are enforced by the room component.
 *
 * @param {{
 *   io: import("socket.io").Server,
 *   socket: import("socket.io").Socket,
 *   roomComponent: ReturnType<typeof import("../../domain/rooms/roomComponent.js").createRoomComponent>,
 *   networkOf: (address: string) => import("../../utils/networkKey.js").NetworkNames,
 *   now: () => number,
 *   logger: import("../../utils/logger.js").Logger,
 * }} deps  `networkOf` names the socket's address when a room is created (see the gateway)
 */
export function createRoomHandlers({ io, socket, roomComponent, networkOf, now, logger }) {
  const identity = socket.data.identity;

  return {
    async [SOCKET_EVENTS.ROOM_CREATE](payload) {
      const { gameId, options } = parseCreateRoom(payload);
      const network = networkOf(socket.data.address);
      const room = await roomComponent.createRoom({
        host: identity,
        network: network.name,
        earlierNetworks: network.earlier,
        gameId,
        options,
        now: now(),
      });
      socket.join(roomChannel(room.code));
      logger.info({ roomCode: room.code, gameId }, "room created");
      return stampedView({ roomComponent, room, viewerId: identity.id, now });
    },

    async [SOCKET_EVENTS.ROOM_JOIN](payload) {
      const { code } = parseRoomRef(payload);
      const room = await roomComponent.joinRoom({ code, player: identity, now: now() });
      socket.join(roomChannel(code));
      logger.info({ roomCode: code, status: room.status }, "joined room");
      await broadcastRoom({ io, roomComponent, room, now, exceptSocketId: socket.id });
      return stampedView({ roomComponent, room, viewerId: identity.id, now });
    },

    async [SOCKET_EVENTS.ROOM_LEAVE](payload) {
      const { code } = parseRoomRef(payload);
      const result = await roomComponent.leaveRoom({ code, playerId: identity.id, now: now() });
      for (const own of await playerSockets(io, code, identity.id)) {
        own.leave(roomChannel(code));
      }
      logger.info({ roomCode: code, closed: result.closed }, "left room");
      if (!result.closed) {
        await broadcastRoom({ io, roomComponent, room: result.room, now });
      }
      return { left: true };
    },

    async [SOCKET_EVENTS.ROOM_REMATCH](payload) {
      const { code } = parseRoomRef(payload);
      const room = await roomComponent.requestRematch({ code, playerId: identity.id, now: now() });
      logger.info({ roomCode: code, status: room.status }, "rematch requested");
      await broadcastRoom({ io, roomComponent, room, now, exceptSocketId: socket.id });
      return stampedView({ roomComponent, room, viewerId: identity.id, now });
    },

    async [SOCKET_EVENTS.ROOM_REMATCH_DECLINE](payload) {
      const { code } = parseRoomRef(payload);
      const room = await roomComponent.declineRematch({ code, playerId: identity.id, now: now() });
      logger.info({ roomCode: code }, "rematch declined");
      await broadcastRoom({ io, roomComponent, room, now, exceptSocketId: socket.id });
      return stampedView({ roomComponent, room, viewerId: identity.id, now });
    },

    async [SOCKET_EVENTS.GAME_MOVE](payload) {
      const { code, move } = parseGameMove(payload);
      const room = await roomComponent.makeMove({ code, playerId: identity.id, move, now: now() });
      await broadcastRoom({ io, roomComponent, room, now, exceptSocketId: socket.id });
      return stampedView({ roomComponent, room, viewerId: identity.id, now });
    },
  };
}

/**
 * Marks the player disconnected in each room this socket was in — unless another of their sockets
 * (another tab) is still connected there.
 *
 * @param {{ io: import("socket.io").Server, roomComponent: any, playerId: string, channels: string[], now: () => number, logger: any }} args
 */
export async function handleSocketGone({ io, roomComponent, playerId, channels, now, logger }) {
  for (const channel of channels) {
    const code = codeFromChannel(channel);
    if ((await playerSockets(io, code, playerId)).length > 0) {
      continue;
    }
    try {
      const room = await roomComponent.playerDisconnected({ code, playerId, now: now() });
      await broadcastRoom({ io, roomComponent, room, now });
    } catch (err) {
      // The room may have closed or the seat been given up meanwhile. Then there is nothing left to record.
      if (!(err instanceof NotFoundError || err instanceof GoneError || err instanceof ForbiddenError)) {
        logger.error({ err, roomCode: code }, "failed to record disconnect");
      }
    }
  }
}
