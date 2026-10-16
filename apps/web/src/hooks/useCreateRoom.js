import { useCallback, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

/** Creates a room (starting a guest session first if needed) and resolves with its code. */
export function useCreateRoom() {
  const { socket } = useServices();
  const session = useSession();
  const [state, setState] = useState({ busy: false, error: undefined });

  const create = useCallback(
    async (gameId, options) => {
      setState({ busy: true, error: undefined });
      try {
        await session.ensurePlayer();
        const room = await socket.request(SOCKET_EVENTS.ROOM_CREATE, { gameId, options });
        setState({ busy: false, error: undefined });
        return room.code;
      } catch (error) {
        setState({ busy: false, error });
        throw error;
      }
    },
    [socket, session],
  );

  return { ...state, create };
}
