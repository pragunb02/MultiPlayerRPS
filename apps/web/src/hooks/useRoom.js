import { useCallback, useEffect, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";

/**
 * One room, kept in sync with the server. Once `enabled` — there is someone to join as — it joins, applies every
 * pushed update for this room, and rejoins after the connection drops and comes back. It never starts a session
 * itself: whoever arrives without one chooses how to join first (CC-086). Leaving the page does not leave the
 * room — only `leave()` does (it forfeits a game in progress).
 *
 * `refresh()` joins again, to learn whether the room is still there when a deadline it showed has passed. A room
 * that has closed answers with a GONE error saying why (CC-101).
 *
 * status: "joining" | "ready" | "closed" | "error"
 *
 * @param {string} code
 * @param {{ enabled: boolean }} options
 */
export function useRoom(code, { enabled }) {
  const { socket } = useServices();
  const [joins, setJoins] = useState(0);
  const [state, setState] = useState({
    status: "joining",
    room: undefined,
    error: undefined,
    closedReason: "",
  });

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let active = true;
    // State changes only in the request's callbacks, after the server answered.
    const join = () =>
      socket.request(SOCKET_EVENTS.ROOM_JOIN, { code }).then(
        (room) => active && setState({ status: "ready", room, error: undefined, closedReason: "" }),
        (error) => active && setState({ status: "error", room: undefined, error, closedReason: "" }),
      );
    // Join now if connected; otherwise the "connect" handler below joins once the socket is up.
    if (socket.isConnected()) {
      join();
    }
    const unsubscribers = [
      socket.on(SOCKET_EVENTS.ROOM_UPDATED, (room) => {
        if (active && room.code === code) setState((s) => ({ ...s, status: "ready", room }));
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
      setState((s) => ({ ...s, room }));
      return room;
    },
    [socket, code],
  );

  const leave = useCallback(() => socket.request(SOCKET_EVENTS.ROOM_LEAVE, { code }), [socket, code]);

  /** Asks for — or withdraws — a rematch in a finished room; once everyone asked, the new game starts here. */
  const rematch = useCallback(async () => {
    const room = await socket.request(SOCKET_EVENTS.ROOM_REMATCH, { code });
    setState((s) => ({ ...s, room }));
    return room;
  }, [socket, code]);

  const refresh = useCallback(() => setJoins((n) => n + 1), []);

  return { ...state, move, leave, rematch, refresh };
}
