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
 * One room, kept in sync with the server. Once `enabled` (there is someone to join as) it joins, applies every
 * pushed update for this room, and rejoins after the connection drops and comes back. It never starts a session
 * itself: whoever arrives without one chooses how to join first (CC-086). Leaving the page leaves a waiting room,
 * so nobody starts a game against a player who has gone (CC-112). The seat is kept when the next page leads back
 * to this room, such as signing up from it. A game in progress or a finished game keeps the seat. Only `leave()`
 * gives it up (it forfeits a game in progress). Leaving the page tells the server the player is away from the
 * room, so the opponent sees it at once and requests still reach them elsewhere (CC-207).
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
      // Nothing waits for this answer: the page is gone, and a seat that is gone already needs no leaving. The
      // game may have started since this page last heard, so the server leaves only a room still waiting.
      socket.request(SOCKET_EVENTS.ROOM_LEAVE, { code, waitingOnly: true }).catch(() => undefined);
    },
    [socket, code],
  );
  // Whether this page holds a seat it has not left, so closing the page should tell the server it is away.
  const seated = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let active = true;
    // State changes only in the request's callbacks, after the server answered.
    const join = () =>
      socket.request(SOCKET_EVENTS.ROOM_JOIN, { code }).then(
        (room) => {
          seated.current = room.you !== "";
          return (
            active &&
            setState((s) => ({
              status: "ready",
              room: newerRoom(s.room, room),
              error: undefined,
              closedReason: "",
            }))
          );
        },
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

  useEffect(
    () => () => {
      if (!seated.current) return;
      seated.current = false;
      // Nothing waits for this answer: the page is already gone, and a room that closed meanwhile has no seat.
      socket.request(SOCKET_EVENTS.ROOM_AWAY, { code }).catch(() => undefined);
    },
    [socket, code],
  );

  /** Sends something that changes the room and shows the room the server answers with. */
  const send = useCallback(
    async (event, payload) => {
      const room = await socket.request(event, { code, ...payload });
      setState((s) => ({ ...s, room: newerRoom(s.room, room) }));
      return room;
    },
    [socket, code],
  );

  const move = useCallback((payload) => send(SOCKET_EVENTS.GAME_MOVE, { move: payload }), [send]);

  const leave = useCallback(async () => {
    seated.current = false;
    waitingSeat.current = false;
    return socket.request(SOCKET_EVENTS.ROOM_LEAVE, { code });
  }, [socket, code]);

  /**
   * Asks the other player something (CC-159): a rematch, or what the game adds such as a draw offer. Asking for
   * what they already asked you accepts it.
   */
  const ask = useCallback((type) => send(SOCKET_EVENTS.ROOM_REQUEST, { type }), [send]);

  /** Accepts, declines or withdraws an open request (a REQUEST_ANSWERS value). */
  const answer = useCallback(
    (type, reply) => send(SOCKET_EVENTS.ROOM_ANSWER, { type, answer: reply }),
    [send],
  );

  /** Claims the win of a game whose opponent stayed offline past the grace period (CC-036). */
  const claimWin = useCallback(() => send(SOCKET_EVENTS.ROOM_CLAIM_WIN, {}), [send]);

  const refresh = useCallback(() => setJoins((n) => n + 1), []);

  return { ...state, move, leave, ask, answer, claimWin, refresh };
}

/** The path and query the browser shows now. */
function addressBar() {
  return `${window.location.pathname}${window.location.search}`;
}
