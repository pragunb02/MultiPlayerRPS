import { io } from "socket.io-client";
import { AppRequestError } from "./errors.js";

const ACK_TIMEOUT_MS = 8_000;

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

    /** @returns {() => void} unsubscribe */
    on(event, handler) {
      socket.on(event, handler);
      return () => socket.off(event, handler);
    },
  });
}
