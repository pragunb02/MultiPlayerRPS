import { useEffect, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";

/**
 * The requests of every room the player sits in, as the server last pushed them to this tab (CC-207). They
 * arrive on any page: whenever a request opens or ends, when a room with requests closes or lets the player go
 * (with none left), and on connecting for every room the player sits in. Each push replaces what the tab knew
 * about that room, and connecting again forgets everything first.
 *
 * @returns {Readonly<Record<string, any>>} the SiteRequests pushes (SOCKET_EVENTS), each with `receivedAt`,
 *   by room code. `receivedAt` is when the push arrived, in this browser's time
 */
export function useSiteRequests() {
  const { socket } = useServices();
  const [rooms, setRooms] = useState({});

  useEffect(() => {
    const unsubscribers = [
      socket.on(SOCKET_EVENTS.REQUEST_UPDATED, (payload) =>
        setRooms((current) => ({ ...current, [payload.code]: { ...payload, receivedAt: Date.now() } })),
      ),
      // A tab that was offline may have missed how its requests ended, or that a room closed. The server tells
      // it about every room the player sits in right after it connects, so it starts again from that.
      socket.on("connect", () => setRooms({})),
    ];
    return () => unsubscribers.forEach((off) => off());
  }, [socket]);

  return rooms;
}
