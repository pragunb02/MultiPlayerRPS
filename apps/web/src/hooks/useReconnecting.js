import { useConnection } from "./useConnection.js";

/**
 * Whether the realtime connection dropped and is being restored (CC-164). It turns true when the connection is
 * lost after this hook started, and false again the moment it is back. While it is true, controls that need the
 * server say "Reconnecting" instead of sending something that cannot arrive. Closing the connection on purpose
 * (signing in or out) is not a lost connection (CC-158).
 *
 * @returns {boolean}
 */
export function useReconnecting() {
  return useConnection().lost;
}
