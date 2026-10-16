import { Server } from "socket.io";
import { SOCKET_EVENTS } from "@classicade/shared";
import { GAMIFICATION_EVENTS } from "../../domain/gamification/gamificationComponent.js";
import { PROGRESSION_EVENTS } from "../../domain/progression/progressionComponent.js";
import { ROOM_EVENTS } from "../../domain/rooms/roomComponent.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { createTokenBucket } from "../../utils/tokenBucket.js";
import { toClientError } from "../errorTranslation.js";
import { requireIdentity } from "../http/session.js";
import { registerHandlers } from "./acknowledgements.js";
import { broadcastRoom, createRoomHandlers, handleSocketGone, roomChannel } from "./roomHandlers.js";

// Per-socket event budget: short bursts are fine, sustained flooding is refused.
const DEFAULT_RATE_LIMIT = Object.freeze({ capacity: 20, refillPerSecond: 10 });
const MAX_MESSAGE_BYTES = 16 * 1024;

const sessionRoom = (sessionId) => `session:${sessionId}`;
/** Every socket of one player (all their tabs), for player-specific pushes such as progress. */
const playerRoom = (playerId) => `player:${playerId}`;

/**
 * Realtime entry point. Connections are accepted only from allowed browser origins and only with a
 * session that holds a valid identity; the identity is read from the server-side session, never from
 * anything the client sends.
 *
 * @param {{
 *   httpServer: import("node:http").Server,
 *   sessionMiddleware: import("express").RequestHandler,
 *   allowedOrigins: ReadonlyArray<string>,
 *   logger: import("../../utils/logger.js").Logger,
 *   roomComponent: ReturnType<typeof import("../../domain/rooms/roomComponent.js").createRoomComponent>,
 *   domainEvents: import("node:events").EventEmitter,
 *   now?: () => number,
 *   rateLimit?: { capacity: number, refillPerSecond: number },
 * }} deps
 */
export function createRealtimeGateway({
  httpServer,
  sessionMiddleware,
  allowedOrigins,
  logger,
  roomComponent,
  domainEvents,
  now = Date.now,
  rateLimit = DEFAULT_RATE_LIMIT,
}) {
  assertDefined(httpServer, "httpServer");
  assertDefined(sessionMiddleware, "sessionMiddleware");
  assertDefined(allowedOrigins, "allowedOrigins");
  assertDefined(logger, "logger");
  assertDefined(roomComponent, "roomComponent");
  assertFunction(domainEvents?.on, "domainEvents.on");

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

  io.use((socket, next) => {
    try {
      socket.data.identity = requireIdentity(socket.request.session);
      socket.data.sessionId = socket.request.sessionID;
      next();
    } catch (err) {
      const { code, message } = toClientError(err);
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
    socket.join([sessionRoom(sessionId), playerRoom(identity.id)]);
    socketLogger.info("socket connected");
    let roomChannels = [];
    socket.on("disconnecting", () => {
      roomChannels = [...socket.rooms].filter((channel) => channel.startsWith("room:"));
    });
    socket.on("disconnect", (reason) => {
      socketLogger.info({ reason }, "socket disconnected");
      handleSocketGone({
        io,
        roomComponent,
        playerId: identity.id,
        channels: roomChannels,
        now,
        logger: socketLogger,
      });
    });

    const bucket = createTokenBucket({ ...rateLimit, now });
    registerHandlers(
      socket,
      {
        [SOCKET_EVENTS.IDENTITY_GET]: () => socket.data.identity,
        ...createRoomHandlers({ io, socket, roomComponent, now, logger: socketLogger }),
      },
      socketLogger,
      { allow: () => bucket.tryTake() },
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
    ({ playerId, source, key, matchId, xpGained, leveledUp, progress }) => {
      io.to(playerRoom(playerId)).emit(SOCKET_EVENTS.PROGRESS_UPDATED, {
        source,
        key,
        matchId,
        xpGained,
        leveledUp,
        progress,
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
    /** Disconnects all sockets and closes the underlying HTTP server. */
    close() {
      return new Promise((resolve, reject) => {
        io.close((err) => (err ? reject(err) : resolve()));
        httpServer.closeIdleConnections();
      });
    },
  });
}
