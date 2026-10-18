import { ROOM_STATUS, SOCKET_EVENTS } from "@classicade/shared";
import { ForbiddenError, GoneError, NotFoundError } from "../../utils/errors.js";
import {
  parseCreateRoom,
  parseGameMove,
  parseLeaveRoom,
  parseRoomAnswer,
  parseRoomRef,
  parseRoomRequest,
} from "./payloads.js";

export const roomChannel = (code) => `room:${code}`;
/** Every socket of one player (all their tabs), for pushes to that player on whatever page they are. */
export const playerChannel = (playerId) => `player:${playerId}`;
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
 *   now: () => number,
 *   logger: import("../../utils/logger.js").Logger,
 * }} deps
 */
export function createRoomHandlers({ io, socket, roomComponent, now, logger }) {
  const identity = socket.data.identity;

  /** This tab left the room's page. Another tab of the player may still show the room: then they are still here. */
  async function goAway(code) {
    socket.leave(roomChannel(code));
    if ((await playerSockets(io, code, identity.id)).length === 0) {
      const room = await roomComponent.playerAway({ code, playerId: identity.id, now: now() });
      await broadcastRoom({ io, roomComponent, room, now });
    }
  }

  return {
    async [SOCKET_EVENTS.ROOM_CREATE](payload) {
      const { gameId, options } = parseCreateRoom(payload);
      const room = await roomComponent.createRoom({
        host: identity,
        network: socket.data.network,
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
      const { code, waitingOnly } = parseLeaveRoom(payload);
      const result = await roomComponent.leaveRoom({ code, playerId: identity.id, now: now(), waitingOnly });
      if (waitingOnly && !result.closed && result.room.status !== ROOM_STATUS.WAITING) {
        // Only a closing room page leaves with `waitingOnly`. Its game started a moment before, so the player is
        // away from it instead of still counting as on its page (CC-112, CC-207).
        await goAway(code);
        return { left: false };
      }
      for (const own of await playerSockets(io, code, identity.id)) {
        own.leave(roomChannel(code));
      }
      logger.info({ roomCode: code, closed: result.closed }, "left room");
      if (!result.closed) {
        await broadcastRoom({ io, roomComponent, room: result.room, now });
      }
      return { left: true };
    },

    async [SOCKET_EVENTS.ROOM_AWAY](payload) {
      const { code } = parseRoomRef(payload);
      await goAway(code);
      return { away: true };
    },

    async [SOCKET_EVENTS.ROOM_REQUEST](payload) {
      const { code, type } = parseRoomRequest(payload);
      const room = await roomComponent.askRequest({ code, playerId: identity.id, type, now: now() });
      logger.info({ roomCode: code, type, status: room.status }, "request asked");
      await broadcastRoom({ io, roomComponent, room, now, exceptSocketId: socket.id });
      return stampedView({ roomComponent, room, viewerId: identity.id, now });
    },

    async [SOCKET_EVENTS.ROOM_ANSWER](payload) {
      const { code, type, answer } = parseRoomAnswer(payload);
      const room = await roomComponent.answerRequest({
        code,
        playerId: identity.id,
        type,
        answer,
        now: now(),
      });
      logger.info({ roomCode: code, type, answer }, "request answered");
      await broadcastRoom({ io, roomComponent, room, now, exceptSocketId: socket.id });
      return stampedView({ roomComponent, room, viewerId: identity.id, now });
    },

    async [SOCKET_EVENTS.ROOM_CLAIM_WIN](payload) {
      const { code } = parseRoomRef(payload);
      const room = await roomComponent.claimWin({ code, playerId: identity.id, now: now() });
      logger.info({ roomCode: code }, "win claimed");
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
 * A socket closed. In each room it showed, the player is now away when another tab of theirs is still open on
 * the site, and offline when none is, unless another tab still shows that room. Once their last tab is gone,
 * the rooms where they were away count them as offline too (CC-158, CC-207).
 *
 * @param {{ io: import("socket.io").Server, roomComponent: any, playerId: string, channels: string[], now: () => number, logger: any }} args
 */
export async function handleSocketGone({ io, roomComponent, playerId, channels, now, logger }) {
  const online = (await io.in(playerChannel(playerId)).fetchSockets()).length > 0;
  for (const channel of channels) {
    const code = codeFromChannel(channel);
    if ((await playerSockets(io, code, playerId)).length > 0) {
      continue;
    }
    try {
      const input = { code, playerId, now: now() };
      const room = online
        ? await roomComponent.playerAway(input)
        : await roomComponent.playerDisconnected(input);
      await broadcastRoom({ io, roomComponent, room, now });
    } catch (err) {
      // The room may have closed or the seat been given up meanwhile. Then there is nothing left to record.
      if (!(err instanceof NotFoundError || err instanceof GoneError || err instanceof ForbiddenError)) {
        logger.error({ err, roomCode: code }, "failed to record disconnect");
      }
    }
  }
  if (!online) {
    // The rooms that changed are announced by the room component and pushed by the gateway.
    await roomComponent
      .playerOffline({ playerId, now: now() })
      .catch((err) => logger.error({ err }, "failed to record that the player went offline"));
  }
}

/**
 * A player's socket connected: rooms where they were offline now count them as away, and this tab hears about
 * every request still open in their rooms, so a question reaches them on whatever page they opened (CC-207).
 *
 * @param {{ socket: import("socket.io").Socket, roomComponent: any, now: () => number, logger: any }} args
 */
export async function handleSocketOnline({ socket, roomComponent, now, logger }) {
  const playerId = socket.data.identity.id;
  try {
    await roomComponent.playerOnline({ playerId, now: now() });
    for (const room of await roomComponent.roomsWithOpenRequests({ playerId, now: now() })) {
      socket.emit(SOCKET_EVENTS.REQUEST_UPDATED, { ...roomComponent.requestsView(room), serverTime: now() });
    }
  } catch (err) {
    logger.error({ err }, "failed to record that the player came online");
  }
}

/**
 * Tells every tab of a room's players about its requests whenever they open or end, on whatever page those tabs
 * are (CC-207).
 *
 * @param {{ io: import("socket.io").Server, roomComponent: any, room: any, now: () => number }} args
 */
export function pushRequests({ io, roomComponent, room, now }) {
  const payload = { ...roomComponent.requestsView(room), serverTime: now() };
  for (const seat of room.seats) {
    io.to(playerChannel(seat.playerId)).emit(SOCKET_EVENTS.REQUEST_UPDATED, payload);
  }
}
