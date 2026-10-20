import { io } from "socket.io-client";
import { bucketOf, ERROR_CODES, SOCKET_EVENTS, TELEMETRY_BUCKETS } from "@classicade/shared";
import { AppRequestError } from "./errors.js";

const ACK_TIMEOUT_MS = 8_000;
/** The lower ends of the `after_s` buckets after the first: 10 s, a minute, 10 minutes (EVENTS.md 3.5). */
const AWAY_EDGES_S = Object.freeze([10, 60, 600]);
/** Socket.IO's reason when the server disconnected the socket on purpose. It does not reconnect after it. */
const SERVER_DISCONNECT = "io server disconnect";

/**
 * The realtime client — the only place the web app touches Socket.IO. Requests resolve with `data` or reject
 * with AppRequestError (same codes as HTTP); pushes are subscribed with `on`, which returns an unsubscribe.
 *
 * Usage counts (CC-174) hear of each request (`onRequest`), of the connection failing, dropping and coming back
 * (`onChange`, with Socket.IO's reason and, when back, how long it was gone as a bucket) and of the first move this
 * page sent (`onFirstMove`, with the game's id).
 *
 * @param {{
 *   connect?: typeof io,
 *   url?: string,
 *   onRequest?: () => void,
 *   onChange?: (change: { state: "connect_failed" | "dropped" | "restored", reason: unknown, afterS?: string }) => void,
 *   onFirstMove?: (gameId: string) => void,
 *   now?: () => number,
 * }} [options]  `connect`, `url` and `now` are injectable for tests
 */
export function createSocketClient({
  connect = io,
  url = undefined,
  onRequest = () => undefined,
  onChange = () => undefined,
  onFirstMove = () => undefined,
  now = () => Date.now(),
} = {}) {
  const socket = connect(url, { autoConnect: false, transports: ["websocket"], withCredentials: true });
  let droppedAt;
  let lastReason;
  let moved = false;
  socket.on("disconnect", (reason) => {
    droppedAt = now();
    lastReason = reason;
    onChange({ state: "dropped", reason });
  });
  socket.on("connect_error", (error) => onChange({ state: "connect_failed", reason: error }));
  socket.on("connect", () => {
    if (droppedAt === undefined) return;
    const awayS = (now() - droppedAt) / 1000;
    droppedAt = undefined;
    onChange({
      state: "restored",
      reason: lastReason,
      afterS: bucketOf(awayS, AWAY_EDGES_S, TELEMETRY_BUCKETS.AFTER_S),
    });
  });

  return Object.freeze({
    connect: () => socket.connect(),
    disconnect: () => socket.disconnect(),
    isConnected: () => socket.connected,

    /**
     * @param {string} event    SOCKET_EVENTS value
     * @param {unknown} [payload]
     */
    async request(event, payload) {
      onRequest();
      let ack;
      try {
        ack = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload);
      } catch {
        throw new AppRequestError({ code: "TIMEOUT", message: "The server took too long to answer" });
      }
      if (!ack?.ok) {
        throw new AppRequestError(ack?.error ?? { code: "UNKNOWN", message: "Something went wrong" });
      }
      if (event === SOCKET_EVENTS.GAME_MOVE && !moved && typeof ack.data?.gameId === "string") {
        moved = true;
        onFirstMove(ack.data.gameId);
      }
      return ack.data;
    },

    /**
     * Calls `handler` when the server ended this connection on purpose: it disconnected the socket (a log out, a sign
     * in or a sign out from another device) or refused to connect it because the session may no longer be used.
     * Socket.IO does not reconnect after either, so whoever listens must ask the server who the browser is now
     * (CC-234). A network drop or a server restart is not reported, because Socket.IO reconnects by itself.
     *
     * @param {() => void} handler
     * @returns {() => void} unsubscribe
     */
    onEndedByServer(handler) {
      const onDisconnect = (reason) => {
        if (reason === SERVER_DISCONNECT) handler();
      };
      const onRefused = (err) => {
        if (err?.data?.code === ERROR_CODES.UNAUTHORIZED) handler();
      };
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onRefused);
      return () => {
        socket.off("disconnect", onDisconnect);
        socket.off("connect_error", onRefused);
      };
    },

    /** @returns {() => void} unsubscribe */
    on(event, handler) {
      socket.on(event, handler);
      return () => socket.off(event, handler);
    },
  });
}
