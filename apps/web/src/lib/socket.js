import { bucketOf, ERROR_CODES, SOCKET_EVENTS, TELEMETRY_BUCKETS } from "@classicade/shared";
import { AppRequestError } from "./errors.js";

const ACK_TIMEOUT_MS = 8_000;
/** The lower ends of the `after_s` buckets after the first: 10 s, a minute, 10 minutes (EVENTS.md 3.5). */
const AWAY_EDGES_S = Object.freeze([10, 60, 600]);
/** Socket.IO's reason when the server disconnected the socket on purpose. It does not reconnect after it. */
const SERVER_DISCONNECT = "io server disconnect";
/** A new object each time: Socket.IO writes to the options it is given while it sets itself up. */
const options = () => ({ autoConnect: false, transports: ["websocket"], withCredentials: true });

/**
 * Socket.IO's client, about 16.6 kB of gzip, in its own download (CC-333). It resolves to nothing when the download
 * failed because the tab is older than the last deploy and `staleBuild.js` is reloading the tab.
 */
/**
 * `promise`, or a rejection once `ms` have passed: a download that never arrives, or one that gave way to a reload,
 * must not keep a request waiting for ever.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function within(promise, ms) {
  let timer;
  const late = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const loadSocketIo = () => import("socket.io-client").then((module) => module?.io);

/**
 * The realtime client — the only place the web app touches Socket.IO. Requests resolve with `data` or reject
 * with AppRequestError (same codes as HTTP); pushes are subscribed with `on`, which returns an unsubscribe.
 *
 * Socket.IO itself is not on the first route (CC-333). This client is a small stand-in that keeps every subscription
 * and the last connect or disconnect until it is here, and downloads it when `needNow()` is called (at once on the
 * pages that need the connection, when the browser is idle on the others, `main.jsx`) or a request is made. Every
 * subscription is attached, in the order it was made, before the socket can connect, so no push can be missed for
 * being early. A failed download is never tried again by itself, only when something needs the socket again
 * (`needNow`, a request, a connect). Only the first try may reload the tab for a newer version (`staleBuild.js`):
 * every later one runs through `quietly`, so a file that stays missing never reloads the tab over and over.
 *
 * Usage counts (CC-174) hear of each request (`onRequest`), of the connection failing, dropping and coming back
 * (`onChange`, with Socket.IO's reason and, when back, how long it was gone as a bucket) and of the first move this
 * page sent (`onFirstMove`, with the game's id).
 *
 * @param {{
 *   load?: () => Promise<typeof import("socket.io-client").io | undefined>,
 *   url?: string,
 *   now?: () => number,
 *   quietly?: <T>(run: () => Promise<T>) => Promise<T>,
 *   onRequest?: () => void,
 *   onChange?: (change: { state: "connect_failed" | "dropped" | "restored", reason: unknown, afterS?: string }) => void,
 *   onFirstMove?: (gameId: string) => void,
 * }} [options]  `quietly` runs a download whose failure must not reload the tab (`recoverFromStaleBuild`'s);
 *   `load`, `url` and `now` are injectable for tests
 */
export function createSocketClient({
  load = loadSocketIo,
  url = undefined,
  now = () => Date.now(),
  quietly = (run) => run(),
  onRequest = () => undefined,
  onChange = () => undefined,
  onFirstMove = () => undefined,
} = {}) {
  /** @type {import("socket.io-client").Socket | undefined} the socket, once Socket.IO is here */
  let socket;
  /** @type {Promise<import("socket.io-client").Socket> | undefined} the download on its way, or done */
  let loading;
  // Something needed the socket at least once, so a later connect downloads it at once.
  let needed = false;
  // The last of connect and disconnect, applied when the socket is here.
  let wanted = false;
  // A download failed once, so the next ones must not reload the tab again.
  let failed = false;
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
    loading ??= (failed ? quietly(load) : load()).then(
      // The tab is reloading for a newer version: nothing here is used again.
      (io) => (io === undefined ? new Promise(() => {}) : arrived(io)),
      (error) => {
        loading = undefined;
        failed = true;
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

  // What usage counts hear of the connection (CC-174), subscribed first so they are attached before any other.
  let droppedAt;
  let lastReason;
  let moved = false;
  on("disconnect", (reason) => {
    droppedAt = now();
    lastReason = reason;
    onChange({ state: "dropped", reason });
  });
  on("connect_error", (error) => onChange({ state: "connect_failed", reason: error }));
  on("connect", () => {
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
      onRequest();
      const sentAt = now();
      let ack;
      try {
        const live = socket ?? (await within(ready(), ACK_TIMEOUT_MS));
        ack = await live.timeout(Math.max(0, ACK_TIMEOUT_MS - (now() - sentAt))).emitWithAck(event, payload);
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
