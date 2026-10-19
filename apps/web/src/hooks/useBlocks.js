import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

/**
 * Blocks a player in a seat of the room this player sits in (CC-044). The server checks that both sit there, and
 * never takes a player id.
 *
 * @returns {(target: { roomCode: string, seat: number, seatId: string }) => Promise<{ blockId: string, displayName: string, blockedAt: number }>}
 */
export function useBlockPlayer() {
  const { api } = useServices();
  return useCallback((target) => api.blockPlayer(target), [api]);
}

/**
 * The players this player blocked, newest first, and a way to unblock one (CC-044). Only the player's own blocks
 * are ever listed, never who blocked them.
 *
 * @returns {{
 *   status: "loading" | "ready" | "error",
 *   blocks: ReadonlyArray<{ blockId: string, displayName: string, blockedAt: number }>,
 *   error: Error | undefined,
 *   unblock: (blockId: string) => Promise<void>,
 * }}
 */
export function useBlockedPlayers() {
  const { api } = useServices();
  const [state, setState] = useState({ status: "loading", blocks: [], error: undefined });

  useEffect(() => {
    let cancelled = false;
    api.getBlocks().then(
      (blocks) => !cancelled && setState({ status: "ready", blocks, error: undefined }),
      (error) => !cancelled && setState({ status: "error", blocks: [], error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  /** Unblocks one player, and takes them off the list once the server agrees. */
  const unblock = useCallback(
    async (blockId) => {
      await api.unblockPlayer(blockId);
      setState((current) => ({
        ...current,
        blocks: current.blocks.filter((block) => block.blockId !== blockId),
      }));
    },
    [api],
  );

  return { ...state, unblock };
}
