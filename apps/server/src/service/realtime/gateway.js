import { Server } from "socket.io";
import { SOCKET_EVENTS } from "@classicade/shared";
import { assertDefined } from "../../utils/assert.js";
import { toClientError } from "../errorTranslation.js";
import { requireIdentity } from "../http/session.js";
import { registerHandlers } from "./acknowledgements.js";

const sessionRoom = (sessionId) => `session:${sessionId}`;

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
 * }} deps
 */
export function createRealtimeGateway({ httpServer, sessionMiddleware, allowedOrigins, logger }) {
  assertDefined(httpServer, "httpServer");
  assertDefined(sessionMiddleware, "sessionMiddleware");
  assertDefined(allowedOrigins, "allowedOrigins");
  assertDefined(logger, "logger");

  const io = new Server(httpServer, {
    serveClient: false,
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
      next(Object.assign(new Error(message), { data: { code } }));
    }
  });

  io.on("connection", (socket) => {
    const { identity, sessionId } = socket.data;
    const socketLogger = logger.child({ socketId: socket.id, playerId: identity.id });
    socket.join(sessionRoom(sessionId));
    socketLogger.info("socket connected");
    socket.on("disconnect", (reason) => socketLogger.info({ reason }, "socket disconnected"));

    registerHandlers(
      socket,
      {
        [SOCKET_EVENTS.IDENTITY_GET]: () => socket.data.identity,
      },
      socketLogger,
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
