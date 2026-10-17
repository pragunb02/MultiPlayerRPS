import { useEffect, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";

/**
 * The requests of every room the player sits in, as the server last pushed them to this tab (CC-207). They
 * arrive on any page: whenever a request opens or ends, and on connecting for every room with one still open.
 * Each push replaces what the tab knew about that room.
 *
 * @returns {Readonly<Record<string, any>>} the SiteRequests pushes (SOCKET_EVENTS), each with `receivedAt`,
 *   by room code. `receivedAt` is when the push arrived, in this browser's time
 */
export function useSiteRequests() {
  const { socket } = useServices();
  const [rooms, setRooms] = useState({});

  useEffect(
    () =>
      socket.on(SOCKET_EVENTS.REQUEST_UPDATED, (payload) =>
        setRooms((current) => ({ ...current, [payload.code]: { ...payload, receivedAt: Date.now() } })),
      ),
    [socket],
  );

  return rooms;
}
