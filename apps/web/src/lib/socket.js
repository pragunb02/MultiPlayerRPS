import { ERROR_CODES } from "@classicade/shared";
import { AppRequestError } from "./errors.js";

const ACK_TIMEOUT_MS = 8_000;
/** How long after a failed download of Socket.IO it is tried again, while the connection is wanted. */
const RETRY_MS = 2_000;
/** Socket.IO's reason when the server disconnected the socket on purpose. It does not reconnect after it. */
const SERVER_DISCONNECT = "io server disconnect";
/** A new object each time: Socket.IO writes to the options it is given while it sets itself up. */
const options = () => ({ autoConnect: false, transports: ["websocket"], withCredentials: true });

/**
 * Socket.IO's client, about 16.6 kB of gzip, in its own download (CC-333). It resolves to nothing when the download
 * failed because the tab is older than the last deploy and `staleBuild.js` is reloading the tab.
 */
const loadSocketIo = () => import("socket.io-client").then((module) => module?.io);

/**
 * The realtime client — the only place the web app touches Socket.IO. Requests resolve with `data` or reject
 * with AppRequestError (same codes as HTTP); pushes are subscribed with `on`, which returns an unsubscribe.
 *
 * Socket.IO itself is not on the first route (CC-333). This client is a small stand-in that keeps every subscription
 * and the last connect or disconnect until it is here, and downloads it when `needNow()` is called (at once on the
 * pages that need the connection, when the browser is idle on the others, `main.jsx`) or a request is made. Every
 * subscription is attached, in the order it was made, before the socket can connect, so no push can be missed for
 * being early. A failed download is tried again after a moment while the connection is wanted, and otherwise the
 * next time something needs it.
 *
 * @param {{
 *   load?: () => Promise<typeof import("socket.io-client").io | undefined>,
 *   url?: string,
 *   now?: () => number,
 *   setTimer?: (run: () => void, ms: number) => unknown,
 * }} [options]  injectable for tests
 */
export function createSocketClient({
  load = loadSocketIo,
  url = undefined,
  now = () => Date.now(),
  setTimer = (run, ms) => setTimeout(run, ms),
} = {}) {
  /** @type {import("socket.io-client").Socket | undefined} the socket, once Socket.IO is here */
  let socket;
  /** @type {Promise<import("socket.io-client").Socket> | undefined} the download on its way, or done */
  let loading;
  // Something needed the socket at least once, so a later connect downloads it at once.
  let needed = false;
  // The last of connect and disconnect, applied when the socket is here.
  let wanted = false;
  /** @type {Array<{ event: string, handler: (...args: any[]) => void }>} subscriptions made before it was here */
  const early = [];

  const arrived = (io) => {
    socket = io(url, options());
    early.splice(0).forEach(({ event, handler }) => socket.on(event, handler));
    if (wanted) socket.connect();
    return socket;
  };

  /** @returns {Promise<import("socket.io-client").Socket>} the socket, downloading Socket.IO first if need be */
  const ready = () => {
    needed = true;
    loading ??= load().then(
      // The tab is reloading for a newer version: nothing here is used again.
      (io) => (io === undefined ? new Promise(() => {}) : arrived(io)),
      (error) => {
        loading = undefined;
        if (wanted) setTimer(() => ready().catch(() => undefined), RETRY_MS);
        throw error;
      },
    );
    return loading;
  };

  /** @returns {() => void} unsubscribe */
  const on = (event, handler) => {
    if (socket !== undefined) {
      socket.on(event, handler);
      return () => socket.off(event, handler);
    }
    const entry = { event, handler };
    early.push(entry);
    return () => {
      const index = early.indexOf(entry);
      if (index >= 0) {
        early.splice(index, 1);
      } else {
        socket?.off(event, handler);
      }
    };
  };

  return Object.freeze({
    /** Downloads Socket.IO now, if it is not here yet. A failure is tried again as described above. */
    needNow: () => {
      ready().catch(() => undefined);
    },
    connect: () => {
      wanted = true;
      if (socket !== undefined) {
        socket.connect();
      } else if (needed) {
        ready().catch(() => undefined);
      }
    },
    disconnect: () => {
      wanted = false;
      socket?.disconnect();
    },
    isConnected: () => socket?.connected ?? false,

    /**
     * Downloads Socket.IO first if it is not here yet. The download counts inside the time the server has to answer.
     *
     * @param {string} event    SOCKET_EVENTS value
     * @param {unknown} [payload]
     */
    async request(event, payload) {
      const sentAt = now();
      let ack;
      try {
        const live = await ready();
        ack = await live.timeout(Math.max(0, ACK_TIMEOUT_MS - (now() - sentAt))).emitWithAck(event, payload);
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
      const offs = [
        on("disconnect", (reason) => {
          if (reason === SERVER_DISCONNECT) handler();
        }),
        on("connect_error", (err) => {
          if (err?.data?.code === ERROR_CODES.UNAUTHORIZED) handler();
        }),
      ];
      return () => offs.forEach((off) => off());
    },

    on,
  });
}
