import { useEffect, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";

/**
 * Socket.IO's reasons for a disconnect that nobody needs to be told about: this app closed the connection itself
 * (the player signed in or out), or the server ended the session. Neither is followed by reconnecting.
 */
const ON_PURPOSE = new Set(["io client disconnect", "io server disconnect"]);

/**
 * The state of this tab's realtime connection (CC-158). `lost` turns true when the connection drops after the hook
 * started, and false again the moment it is back. `restarting` is true from the server's notice that it is
 * restarting (a deploy) until the connection is back, so the player can be told their game is safe.
 *
 * @returns {{ lost: boolean, restarting: boolean, drops: number }} `drops` counts the connections lost so far, so
 *   each drop can be told apart from the one before
 */
export function useConnection() {
  const { socket } = useServices();
  const [state, setState] = useState({ lost: false, restarting: false, drops: 0 });

  useEffect(() => {
    const offs = [
      socket.on("disconnect", (reason) => {
        if (!ON_PURPOSE.has(reason))
          setState((current) => ({ ...current, lost: true, drops: current.drops + 1 }));
      }),
      socket.on(SOCKET_EVENTS.SERVER_RESTARTING, () =>
        setState((current) => ({ ...current, restarting: true })),
      ),
      socket.on("connect", () => setState((current) => ({ ...current, lost: false, restarting: false }))),
    ];
    return () => offs.forEach((off) => off());
  }, [socket]);

  return state;
}
