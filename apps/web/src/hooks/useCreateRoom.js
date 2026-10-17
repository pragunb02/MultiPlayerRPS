import { useCallback } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

/**
 * Creates a room, starting a guest session first if needed, and resolves with its code. `create` makes a room to
 * invite a friend to. `playComputer` makes one where the game's computer character already sits, so the game has
 * started when the room opens (CC-221). The button that calls either shows the wait and any failure (see useAction).
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

  const playComputer = useCallback(
    async ({ gameId, level, options }) => {
      await session.ensurePlayer();
      const room = await socket.request(SOCKET_EVENTS.ROOM_PLAY_COMPUTER, { gameId, level, options });
      return room.code;
    },
    [socket, session],
  );

  return { create, playComputer };
}
