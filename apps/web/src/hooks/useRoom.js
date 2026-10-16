import { useCallback, useEffect, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

/**
 * One room, kept in sync with the server. Joins on mount (starting a guest session if needed), applies every
 * pushed update for this room, and rejoins after the connection drops and comes back. Leaving the page does
 * not leave the room — only `leave()` does (it forfeits a game in progress).
 *
 * status: "joining" | "ready" | "closed" | "error"
 *
 * @param {string} code
 */
export function useRoom(code) {
  const { socket } = useServices();
  const session = useSession();
  const [state, setState] = useState({
    status: "joining",
    room: undefined,
    error: undefined,
    closedReason: "",
  });
  const { ensurePlayer } = session;
  const hasIdentity = session.identity !== undefined;

  useEffect(() => {
    let active = true;
    if (!hasIdentity) {
      ensurePlayer().catch((error) => active && setState((s) => ({ ...s, status: "error", error })));
      return () => {
        active = false;
      };
    }
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
  }, [socket, code, hasIdentity, ensurePlayer]);

  const move = useCallback(
    async (payload) => {
      const room = await socket.request(SOCKET_EVENTS.GAME_MOVE, { code, move: payload });
      setState((s) => ({ ...s, room }));
      return room;
    },
    [socket, code],
  );

  const leave = useCallback(() => socket.request(SOCKET_EVENTS.ROOM_LEAVE, { code }), [socket, code]);

  return { ...state, move, leave };
}
