import { QUICK_MATCH_OUTCOMES, SOCKET_EVENTS } from "@classicade/shared";
import { parseQuickMatch } from "./payloads.js";
import { roomChannel, stampedView } from "./roomHandlers.js";

/**
 * Socket handlers for quick match (CC-051, ADR-079), behind the `quick_match` flag. The player's identity comes from
 * the session. The client names only a game and the character's level, never a player or a seat, and the answer
 * names everyone by their seat ids, as every room view does (CC-253).
 *
 * With the flag off for the player, a quick match plays the character at once, exactly as `room:play-computer`.
 * Closing the tab cancels the search it started.
 *
 * @param {{
 *   socket: import("socket.io").Socket,
 *   matchmaking: Pick<ReturnType<typeof import("../../domain/matchmaking/matchmakingComponent.js").createMatchmakingComponent>, "search" | "cancel">,
 *   botComponent: Pick<ReturnType<typeof import("../../domain/bots/botComponent.js").createBotComponent>, "playComputer">,
 *   roomComponent: ReturnType<typeof import("../../domain/rooms/roomComponent.js").createRoomComponent>,
 *   flags: { isOn: (name: string, player: object) => Promise<boolean>, recordSuccess: (name: string, player: object) => Promise<void> },
 *   networkOf: (address: string) => import("../../utils/networkKey.js").NetworkNames,
 *   onlinePlayers: () => number,
 *   now: () => number,
 *   logger: import("../../utils/logger.js").Logger,
 * }} deps  `onlinePlayers` is how many players are connected, this one included, for the liquidity gate (ADR-029)
 */
export function createMatchHandlers({
  socket,
  matchmaking,
  botComponent,
  roomComponent,
  flags,
  networkOf,
  onlinePlayers,
  now,
  logger,
}) {
  const identity = socket.data.identity;
  // The flags read who the player is, never whether they are an admin: quick match is for everyone.
  const flagPlayer = Object.freeze({ id: identity.id, kind: identity.kind, admin: false });

  socket.on("disconnect", () => {
    matchmaking
      .cancel({ playerId: identity.id, socketId: socket.id })
      .catch((err) => logger.error({ err }, "cancelling a quick match search failed"));
  });

  function answer({ outcome, room }) {
    if (room === undefined) return { outcome };
    socket.join(roomChannel(room.code));
    logger.info({ roomCode: room.code, gameId: room.gameId, outcome }, "quick match started a game");
    return { outcome, room: stampedView({ roomComponent, room, viewerId: identity.id, now }) };
  }

  return {
    async [SOCKET_EVENTS.MATCH_QUICK](payload) {
      const { gameId, level } = parseQuickMatch(payload);
      const network = networkOf(socket.data.address);
      if (!(await flags.isOn("quick_match", flagPlayer))) {
        const room = await botComponent.playComputer({
          host: identity,
          network: network.name,
          earlierNetworks: network.earlier,
          gameId,
          options: {},
          level,
          now: now(),
        });
        return answer({ outcome: QUICK_MATCH_OUTCOMES.CHARACTER, room });
      }
      const result = await matchmaking.search({
        player: identity,
        network: network.name,
        earlierNetworks: network.earlier,
        gameId,
        level,
        othersOnline: Math.max(0, onlinePlayers() - 1),
        socketId: socket.id,
      });
      if (result.outcome === QUICK_MATCH_OUTCOMES.PERSON) {
        await flags.recordSuccess("quick_match", flagPlayer);
      }
      return answer(result);
    },

    [SOCKET_EVENTS.MATCH_CANCEL]: () => matchmaking.cancel({ playerId: identity.id }),
  };
}
