import { useCallback } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

/**
 * Creates a room, starting a guest session first if needed, and resolves with its code. `create` makes a room to
 * invite a friend to. `playComputer` makes one where the game's computer character already sits, so the game has
 * started when the room opens (CC-221). `quickMatch` looks for a person first and resolves with how it ended and
 * the room of the game that started, if any (CC-051), and `cancelQuickMatch` ends that search. `challenge` makes a challenge link that lasts a day instead (CC-139) and
 * resolves with its id. The button that calls either shows the wait and any failure (see useAction).
 */
export function useCreateRoom() {
  const { api, socket } = useServices();
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

  const quickMatch = useCallback(
    async ({ gameId, level }) => {
      await session.ensurePlayer();
      const { outcome, room } = await socket.request(SOCKET_EVENTS.MATCH_QUICK, { gameId, level });
      return { outcome, code: room?.code };
    },
    [socket, session],
  );

  const cancelQuickMatch = useCallback(
    () => socket.request(SOCKET_EVENTS.MATCH_CANCEL).catch(() => ({ cancelled: false })),
    [socket],
  );

  const challenge = useCallback(
    async ({ gameId, options }) => {
      await session.ensurePlayer();
      return (await api.createChallenge({ gameId, options })).id;
    },
    [api, session],
  );

  return { create, playComputer, quickMatch, cancelQuickMatch, challenge };
}
