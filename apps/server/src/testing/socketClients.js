import { io as connect } from "socket.io-client";
import { SOCKET_EVENTS } from "@classicade/shared";

/**
 * Test helper: real guests with real sessions and real Socket.IO connections against a test server.
 * Call `disconnectAll()` in afterEach.
 *
 * @param {() => string} baseUrl  resolved lazily, so the helper can be created before the server starts
 */
export function createSocketClients(baseUrl) {
  const open = [];

  /**
   * @param {string} cookie
   * @param {{ listen?: (socket: import("socket.io-client").Socket) => void }} [options]  `listen` subscribes
   *   before the socket connects, for pushes the server sends the moment it does
   */
  async function openSocket(cookie, { listen = () => undefined } = {}) {
    const socket = connect(baseUrl(), {
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
    });
    open.push(socket);
    listen(socket);
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }

  /** A new guest: session cookie, identity, connected socket, and a log of everything the socket received. */
  async function player() {
    const res = await fetch(`${baseUrl()}/api/session/guest`, { method: "POST" });
    const cookie = res.headers.get("set-cookie").split(";")[0];
    const { identity } = await res.json();
    const socket = await openSocket(cookie);
    const received = [];
    socket.onAny((event, payload) => received.push({ event, payload }));
    return { identity, cookie, socket, received };
  }

  return {
    player,
    openSocket,
    disconnectAll: () => open.splice(0).forEach((socket) => socket.disconnect()),
  };
}

/** Emits a client → server event and resolves with its acknowledgement. */
export const send = (socket, event, payload) => socket.timeout(2_000).emitWithAck(event, payload);

/** Resolves with the next server push of `event` (default: room update). */
export const nextEvent = (socket, event = SOCKET_EVENTS.ROOM_UPDATED) =>
  new Promise((resolve) => socket.once(event, resolve));

/**
 * Resolves with the first server push of `event` that passes `test`. Presence can change a few times in a row
 * (offline, then away, then here), so a test waits for the state it expects instead of counting pushes.
 */
export const eventWhere = (socket, test, event = SOCKET_EVENTS.ROOM_UPDATED) =>
  new Promise((resolve) => {
    const listener = (payload) => {
      if (test(payload)) {
        socket.off(event, listener);
        resolve(payload);
      }
    };
    socket.on(event, listener);
  });

/**
 * Host creates a room, guest joins, and the host has seen the game start.
 *
 * `seat` holds each player's seat id, as their own view tells them: room views name players by seat id only (CC-253).
 *
 * @returns {Promise<{ code: string, hostStart: object, joined: object, created: object, seat: { host: string, guest: string } }>}
 */
export async function startRoom(host, guest, { gameId, options = {} }) {
  const created = await send(host.socket, SOCKET_EVENTS.ROOM_CREATE, { gameId, options });
  if (!created.ok) {
    throw new Error(`room:create failed: ${created.error.message}`);
  }
  const hostSeesStart = nextEvent(host.socket);
  const joined = await send(guest.socket, SOCKET_EVENTS.ROOM_JOIN, { code: created.data.code });
  return {
    code: created.data.code,
    joined,
    created,
    hostStart: await hostSeesStart,
    seat: { host: created.data.you, guest: joined.data.you },
  };
}
