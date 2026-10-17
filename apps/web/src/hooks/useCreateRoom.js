import { useCallback } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

/**
 * Creates a room, starting a guest session first if needed, and resolves with its code. The button that calls it
 * shows the wait and any failure (see useAction).
 */
export function useCreateRoom() {
  const { socket } = useServices();
  const session = useSession();

  const create = useCallback(
    async (gameId, options) => {
      await session.ensurePlayer();
      const room = await socket.request(SOCKET_EVENTS.ROOM_CREATE, { gameId, options });
      return room.code;
    },
    [socket, session],
  );

  return { create };
}
