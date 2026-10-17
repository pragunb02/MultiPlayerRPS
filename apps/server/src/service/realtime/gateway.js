import { Server } from "socket.io";
import { SOCKET_EVENTS } from "@classicade/shared";
import { GAMIFICATION_EVENTS } from "../../domain/gamification/gamificationComponent.js";
import { PROGRESSION_EVENTS } from "../../domain/progression/progressionComponent.js";
import { ROOM_EVENTS } from "../../domain/rooms/roomComponent.js";
import { roomLimits } from "../../domain/rooms/roomLimits.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { TooManyRequestsError } from "../../utils/errors.js";
import { toClientError } from "../errorTranslation.js";
import { addressKey, clientAddress } from "../http/rateLimits.js";
import { requireIdentity } from "../http/session.js";
import { registerHandlers } from "./acknowledgements.js";
import { trackConnections } from "./connections.js";
import { broadcastRoom, createRoomHandlers, handleSocketGone, roomChannel } from "./roomHandlers.js";
import { createSocketAdmission } from "./socketAdmission.js";

const MAX_MESSAGE_BYTES = 16 * 1024;

const sessionRoom = (sessionId) => `session:${sessionId}`;
/** Every socket of one player (all their tabs), for player-specific pushes such as progress. */
const playerRoom = (playerId) => `player:${playerId}`;

/**
 * Realtime entry point. Connections are accepted only from allowed browser origins and only with a
 * session that holds a valid identity; the identity is read from the server-side session, never from
 * anything the client sends. A session that was signed out elsewhere or is too old is refused (CC-116), and so is
 * a connection over the caps per session and per network address (CC-107). Every player has one event budget
 * shared by all their tabs.
 *
 * @param {{
 *   httpServer: import("node:http").Server,
 *   sessionMiddleware: import("express").RequestHandler,
 *   allowedOrigins: ReadonlyArray<string>,
 *   logger: import("../../utils/logger.js").Logger,
 *   roomComponent: ReturnType<typeof import("../../domain/rooms/roomComponent.js").createRoomComponent>,
 *   domainEvents: import("node:events").EventEmitter,
 *   checkSession: (sessionData: object) => Promise<void>,   throws UnauthorizedError for a session that may no
 *     longer be used (see createSessionCheck)
 *   trustProxyHops: number,   how many proxies to look through for the player's address, as for HTTP
 *   networkOf: (address: string) => string,   names an address without being it, for the rooms per network
 *   limits?: Readonly<import("../../domain/rooms/roomLimits.js").RoomLimits>,
 *   now?: () => number,
 * }} deps
 */
export function createRealtimeGateway({
  httpServer,
  sessionMiddleware,
  allowedOrigins,
  logger,
  roomComponent,
  domainEvents,
  checkSession,
  trustProxyHops,
  networkOf,
  limits = roomLimits(),
  now = Date.now,
}) {
  assertDefined(httpServer, "httpServer");
  assertDefined(sessionMiddleware, "sessionMiddleware");
  assertDefined(allowedOrigins, "allowedOrigins");
  assertDefined(logger, "logger");
  assertDefined(roomComponent, "roomComponent");
  assertFunction(domainEvents?.on, "domainEvents.on");
  assertFunction(checkSession, "checkSession");
  assertDefined(trustProxyHops, "trustProxyHops");
  assertFunction(networkOf, "networkOf");

  const io = new Server(httpServer, {
    serveClient: false,
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    // Browsers always send Origin on the handshake; rejecting foreign origins blocks cross-site
    // WebSocket hijacking with a victim's cookies. Non-browser clients send none and carry no cookies.
    allowRequest: (req, callback) => {
      const { origin } = req.headers;
      callback(null, origin === undefined || allowedOrigins.includes(origin));
    },
  });

  io.engine.use(sessionMiddleware);

  // While the server shuts down every socket is cut, but the players are not leaving: their browsers
  // reconnect to the next server, which starts by marking everyone away (CC-101). Recording each cut here
  // would only race the database closing.
  let closing = false;
  const connections = trackConnections(httpServer);
  const admission = createSocketAdmission({ limits, now });
  /**
   * How often each player has signed out their other devices, and which session stayed (CC-116). A handshake that
   * was being checked while that happened had not joined the player's channel yet, so it was missed. It is
   * disconnected as soon as it connects instead.
   *
   * @type {Map<string, { generation: number, keptSessionId: string }>}
   */
  const signOuts = new Map();
  const signOutGeneration = (playerId) => signOuts.get(playerId)?.generation ?? 0;

  io.use(async (socket, next) => {
    try {
      socket.data.identity = requireIdentity(socket.request.session);
      socket.data.sessionId = socket.request.sessionID;
      socket.data.signOutGeneration = signOutGeneration(socket.data.identity.id);
      await checkSession(socket.request.session);
      const address = clientAddress({
        remoteAddress: socket.request.socket.remoteAddress,
        forwardedFor: socket.request.headers["x-forwarded-for"],
        trustProxyHops,
      });
      const admitted = admission.admit({
        sessionId: socket.data.sessionId,
        address: addressKey(address),
        playerId: socket.data.identity.id,
      });
      if (!admitted.admitted) {
        throw new TooManyRequestsError(admitted.message);
      }
      socket.data.release = admitted.release;
      socket.data.network = networkOf(addressKey(address));
      // The browser may have gone while its session was checked. Socket.IO then drops the socket without any
      // event, so the place is given back when the connection itself closes, or now if it already has.
      if (socket.conn.readyState === "open") {
        socket.conn.once("close", admitted.release);
      } else {
        admitted.release();
      }
      next();
    } catch (err) {
      const { status, code, message } = toClientError(err);
      if (status >= 500) {
        // The check itself failed (the database is down, for example), not the player.
        logger.error({ err }, "checking a socket's session failed");
      }
      // Why a client couldn't connect, for operators (and failing tests, CC-079) — never the session id itself.
      logger.warn(
        {
          code,
          reason: message,
          sentCookie: Boolean(socket.request.headers.cookie),
          hadSession: socket.request.session !== undefined,
        },
        "socket refused",
      );
      next(Object.assign(new Error(message), { data: { code } }));
    }
  });

  io.on("connection", (socket) => {
    const { identity, sessionId } = socket.data;
    const socketLogger = logger.child({ socketId: socket.id, playerId: identity.id });
    const signOut = signOuts.get(identity.id);
    if (
      signOut !== undefined &&
      signOut.generation !== socket.data.signOutGeneration &&
      signOut.keptSessionId !== sessionId
    ) {
      socketLogger.info("socket of a session signed out during its handshake disconnected");
      socket.data.release();
      socket.disconnect(true);
      return;
    }
    socket.join([sessionRoom(sessionId), playerRoom(identity.id)]);
    socketLogger.info("socket connected");
    let roomChannels = [];
    socket.on("disconnecting", () => {
      roomChannels = [...socket.rooms].filter((channel) => channel.startsWith("room:"));
    });
    socket.on("disconnect", (reason) => {
      socket.data.release();
      socketLogger.info({ reason }, "socket disconnected");
      if (closing) return;
      handleSocketGone({
        io,
        roomComponent,
        playerId: identity.id,
        channels: roomChannels,
        now,
        logger: socketLogger,
      });
    });

    registerHandlers(
      socket,
      {
        [SOCKET_EVENTS.IDENTITY_GET]: () => socket.data.identity,
        ...createRoomHandlers({ io, socket, roomComponent, now, logger: socketLogger }),
      },
      socketLogger,
      { allow: () => admission.allowEvent(identity.id) },
    );
  });

  // Domain → transport: tell everyone in a closed room, then empty the channel.
  domainEvents.on(ROOM_EVENTS.CLOSED, ({ code, reason }) => {
    io.to(roomChannel(code)).emit(SOCKET_EVENTS.ROOM_CLOSED, { code, reason });
    io.in(roomChannel(code)).socketsLeave(roomChannel(code));
    logger.info({ roomCode: code, reason }, "room closed");
  });

  // Domain → transport: progress after a recorded match goes to every tab of that player.
  domainEvents.on(
    PROGRESSION_EVENTS.UPDATED,
    ({ playerId, source, key, matchId, xpGained, leveledUp, progress, counted, notCountedReason }) => {
      io.to(playerRoom(playerId)).emit(SOCKET_EVENTS.PROGRESS_UPDATED, {
        source,
        key,
        matchId,
        xpGained,
        leveledUp,
        progress,
        counted,
        notCountedReason,
      });
    },
  );

  // Domain → transport: achievements, quests and streaks go to every tab of the player concerned only (CC-054).
  domainEvents.on(GAMIFICATION_EVENTS.ACHIEVEMENTS_UNLOCKED, ({ playerId, achievements }) => {
    io.to(playerRoom(playerId)).emit(SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED, { achievements });
  });
  domainEvents.on(GAMIFICATION_EVENTS.QUESTS_UPDATED, ({ playerId, quests }) => {
    io.to(playerRoom(playerId)).emit(SOCKET_EVENTS.QUESTS_UPDATED, { quests });
  });
  domainEvents.on(GAMIFICATION_EVENTS.STREAKS_UPDATED, ({ playerId, streaks }) => {
    io.to(playerRoom(playerId)).emit(SOCKET_EVENTS.STREAKS_UPDATED, { streaks });
  });

  // Domain → transport: a room changed on its own (e.g. a clock ran out) — push everyone their new view.
  domainEvents.on(ROOM_EVENTS.UPDATED, ({ room }) => {
    broadcastRoom({ io, roomComponent, room, now }).catch((err) =>
      logger.error({ err, roomCode: room.code }, "failed to broadcast room update"),
    );
  });

  return Object.freeze({
    io,
    /** Disconnects every socket opened with this session (e.g. after logout). */
    disconnectSession(sessionId) {
      io.in(sessionRoom(sessionId)).disconnectSockets(true);
    },
    /**
     * The device that changed the password or asked to sign out its other devices got a new session id (CC-116).
     * Its sockets move from the old id to the new one and stay connected. Every other socket of the player is
     * disconnected, and so is any handshake of the player that is being checked right now.
     *
     * @param {{ playerId: string, fromSessionId: string, toSessionId: string }} which
     */
    async disconnectOtherSessions({ playerId, fromSessionId, toSessionId }) {
      signOuts.set(playerId, { generation: signOutGeneration(playerId) + 1, keptSessionId: toSessionId });
      for (const socket of await io.in(sessionRoom(fromSessionId)).fetchSockets()) {
        socket.leave(sessionRoom(fromSessionId));
        socket.join(sessionRoom(toSessionId));
        socket.data.sessionId = toSessionId;
      }
      io.in(playerRoom(playerId)).except(sessionRoom(toSessionId)).disconnectSockets(true);
    },
    /** @returns {{ connections: number, players: number }} realtime connections and connected players, for the gauge */
    counts: () => admission.counts(),
    /** Disconnects all sockets and closes the underlying HTTP server. */
    close() {
      closing = true;
      return new Promise((resolve, reject) => {
        io.close((err) => (err ? reject(err) : resolve()));
        connections.closeIdle();
      });
    },
  });
}
