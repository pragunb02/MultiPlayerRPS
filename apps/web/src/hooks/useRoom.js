import { useCallback, useEffect, useRef, useState } from "react";
import { ROOM_STATUS, SOCKET_EVENTS } from "@classicade/shared";
import { returnsToRoom } from "../app/paths.js";
import { useServices } from "../app/servicesContext.js";

/**
 * The newer of two views of a room. An update can overtake the answer to a request: a computer player may move
 * before the answer to the move it replies to arrives (CC-138). The revision says which is newer. A view without
 * one (from a server before it existed) always counts as newer.
 */
export const newerRoom = (current, incoming) =>
  current?.code === incoming.code && current.revision > incoming.revision ? current : incoming;

/**
 * One room, kept in sync with the server. Once `enabled` — there is someone to join as — it joins, applies every
 * pushed update for this room, and rejoins after the connection drops and comes back. It never starts a session
 * itself: whoever arrives without one chooses how to join first (CC-086). Leaving the page leaves a waiting room,
 * so nobody starts a game against a player who has gone (CC-112). The seat is kept when the next page leads back
 * to this room, such as signing up from it. A game in progress or a finished game keeps the seat: only `leave()`
 * gives it up (it forfeits a game in progress).
 *
 * `refresh()` joins again, to learn whether the room is still there when a deadline it showed has passed. A room
 * that has closed answers with a GONE error saying why (CC-101).
 *
 * status: "joining" | "ready" | "closed" | "error"
 *
 * @param {string} code
 * @param {{ enabled: boolean, currentPath?: () => string }} options  `currentPath` is where the browser is when the
 *   room page goes away. The router has already moved by then. Tests give it, the app reads the address bar.
 */
export function useRoom(code, { enabled, currentPath = addressBar }) {
  const { socket } = useServices();
  const [joins, setJoins] = useState(0);
  const [state, setState] = useState({
    status: "joining",
    room: undefined,
    error: undefined,
    closedReason: "",
  });
  // Whether the viewer holds a seat in this room while it waits for players. A ref, because the cleanup that
  // leaves the room must see the latest room, not the one from when that effect started.
  const waitingSeat = useRef(false);
  const room = state.room;
  useEffect(() => {
    waitingSeat.current = room !== undefined && room.you !== "" && room.status === ROOM_STATUS.WAITING;
  }, [room]);
  const pathNow = useRef(currentPath);
  useEffect(() => {
    pathNow.current = currentPath;
  }, [currentPath]);

  useEffect(
    () => () => {
      if (!waitingSeat.current || returnsToRoom(pathNow.current(), code)) return;
      waitingSeat.current = false;
      // Nothing waits for this answer: the page is gone, and a seat that is gone already needs no leaving.
      socket.request(SOCKET_EVENTS.ROOM_LEAVE, { code }).catch(() => undefined);
    },
    [socket, code],
  );

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let active = true;
    // State changes only in the request's callbacks, after the server answered.
    const join = () =>
      socket.request(SOCKET_EVENTS.ROOM_JOIN, { code }).then(
        (room) =>
          active &&
          setState((s) => ({
            status: "ready",
            room: newerRoom(s.room, room),
            error: undefined,
            closedReason: "",
          })),
        (error) => active && setState({ status: "error", room: undefined, error, closedReason: "" }),
      );
    // Join now if connected; otherwise the "connect" handler below joins once the socket is up.
    if (socket.isConnected()) {
      join();
    }
    const unsubscribers = [
      socket.on(SOCKET_EVENTS.ROOM_UPDATED, (room) => {
        if (active && room.code === code)
          setState((s) => ({ ...s, status: "ready", room: newerRoom(s.room, room) }));
      }),
      socket.on(SOCKET_EVENTS.ROOM_CLOSED, (event) => {
        if (active && event.code === code)
          setState((s) => ({ ...s, status: "closed", closedReason: event.reason }));
      }),
      // First connect, and every reconnect (the server forgets a dropped socket's rooms): join.
      socket.on("connect", () => active && join()),
    ];
    return () => {
      active = false;
      unsubscribers.forEach((off) => off());
    };
  }, [socket, code, enabled, joins]);

  const move = useCallback(
    async (payload) => {
      const room = await socket.request(SOCKET_EVENTS.GAME_MOVE, { code, move: payload });
      setState((s) => ({ ...s, room: newerRoom(s.room, room) }));
      return room;
    },
    [socket, code],
  );

  const leave = useCallback(() => {
    waitingSeat.current = false;
    return socket.request(SOCKET_EVENTS.ROOM_LEAVE, { code });
  }, [socket, code]);

  /** Asks for — or withdraws — a rematch in a finished room; once everyone asked, the new game starts here. */
  const rematch = useCallback(async () => {
    const room = await socket.request(SOCKET_EVENTS.ROOM_REMATCH, { code });
    setState((s) => ({ ...s, room: newerRoom(s.room, room) }));
    return room;
  }, [socket, code]);

  const refresh = useCallback(() => setJoins((n) => n + 1), []);

  /** Says no to the opponent's rematch request (CC-104). They are told, and either player may ask again. */
  const declineRematch = useCallback(async () => {
    const room = await socket.request(SOCKET_EVENTS.ROOM_REMATCH_DECLINE, { code });
    setState((s) => ({ ...s, room: newerRoom(s.room, room) }));
    return room;
  }, [socket, code]);

  return { ...state, move, leave, rematch, declineRematch, refresh };
}

/** The path and query the browser shows now. */
function addressBar() {
  return `${window.location.pathname}${window.location.search}`;
}
