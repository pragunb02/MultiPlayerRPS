import { io } from "socket.io-client";
import { ERROR_CODES } from "@classicade/shared";
import { AppRequestError } from "./errors.js";

const ACK_TIMEOUT_MS = 8_000;
/** Socket.IO's reason when the server disconnected the socket on purpose. It does not reconnect after it. */
const SERVER_DISCONNECT = "io server disconnect";

/**
 * The realtime client — the only place the web app touches Socket.IO. Requests resolve with `data` or reject
 * with AppRequestError (same codes as HTTP); pushes are subscribed with `on`, which returns an unsubscribe.
 *
 * @param {{ connect?: typeof io, url?: string }} [options]  injectable for tests
 */
export function createSocketClient({ connect = io, url = undefined } = {}) {
  const socket = connect(url, { autoConnect: false, transports: ["websocket"], withCredentials: true });

  return Object.freeze({
    connect: () => socket.connect(),
    disconnect: () => socket.disconnect(),
    isConnected: () => socket.connected,

    /**
     * @param {string} event    SOCKET_EVENTS value
     * @param {unknown} [payload]
     */
    async request(event, payload) {
      let ack;
      try {
        ack = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload);
      } catch {
        throw new AppRequestError({ code: "TIMEOUT", message: "The server took too long to answer" });
      }
      if (!ack?.ok) {
        throw new AppRequestError(ack?.error ?? { code: "UNKNOWN", message: "Something went wrong" });
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
