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

  async function openSocket(cookie) {
    const socket = connect(baseUrl(), {
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
    });
    open.push(socket);
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
 * Host creates a room, guest joins, and the host has seen the game start.
 *
 * @returns {Promise<{ code: string, hostStart: object, joined: object }>}
 */
export async function startRoom(host, guest, { gameId, options = {} }) {
  const created = await send(host.socket, SOCKET_EVENTS.ROOM_CREATE, { gameId, options });
  if (!created.ok) {
    throw new Error(`room:create failed: ${created.error.message}`);
  }
  const hostSeesStart = nextEvent(host.socket);
  const joined = await send(guest.socket, SOCKET_EVENTS.ROOM_JOIN, { code: created.data.code });
  return { code: created.data.code, joined, created, hostStart: await hostSeesStart };
}
