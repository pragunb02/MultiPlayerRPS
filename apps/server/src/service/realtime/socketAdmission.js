import { createTokenBucket } from "../../utils/tokenBucket.js";

/** Why a realtime connection was refused. The messages are shown to players, so they say what to do. */
export const SOCKET_REFUSALS = Object.freeze({
  SESSION: "Too many tabs are connected. Close one and try again.",
  ADDRESS: "Too many connections from your network. Try again in a minute.",
});

/**
 * Counts realtime connections and events against the limits in roomLimits.js (CC-107). It lives in this process
 * only: a restart drops every connection anyway, so the counts start again from nothing with them.
 *
 * 1. A connection is admitted while its browser session and its network address are under their caps. It is
 *    counted until it closes.
 * 2. Every event of a player takes from one budget shared by all their connections, so opening more tabs does not
 *    buy more events. A player's budget is kept while they are connected, and for as long as it is still refilling
 *    after they leave, so leaving and coming back does not refill it any sooner.
 *
 * @param {{ limits: Readonly<import("../../domain/rooms/roomLimits.js").RoomLimits>, now: () => number }} deps
 */
export function createSocketAdmission({ limits, now }) {
  /** @type {Map<string, number>} */
  const perSession = new Map();
  /** @type {Map<string, number>} */
  const perAddress = new Map();
  /** @type {Map<string, { sockets: number, bucket: ReturnType<typeof createTokenBucket> }>} */
  const players = new Map();

  const add = (counts, key, change) => {
    const next = (counts.get(key) ?? 0) + change;
    if (next === 0) counts.delete(key);
    else counts.set(key, next);
  };

  /** Budgets of players who left and whose budget has refilled are no longer needed. */
  function forgetRefilled() {
    for (const [playerId, player] of players) {
      if (player.sockets === 0 && player.bucket.isFull()) players.delete(playerId);
    }
  }

  return Object.freeze({
    /**
     * Admits a new connection, or answers why not. An admitted connection must be released when it closes.
     *
     * @param {{ sessionId: string, address: string, playerId: string }} connection  `address` is a rate limit key
     * @returns {{ admitted: true, release: () => void } | { admitted: false, message: string }}
     */
    admit({ sessionId, address, playerId }) {
      if ((perSession.get(sessionId) ?? 0) >= limits.socketsPerSession) {
        return { admitted: false, message: SOCKET_REFUSALS.SESSION };
      }
      if ((perAddress.get(address) ?? 0) >= limits.socketsPerAddress) {
        return { admitted: false, message: SOCKET_REFUSALS.ADDRESS };
      }
      forgetRefilled();
      add(perSession, sessionId, 1);
      add(perAddress, address, 1);
      const player = players.get(playerId) ?? {
        sockets: 0,
        bucket: createTokenBucket({
          capacity: limits.eventBurstPerPlayer,
          refillPerSecond: limits.eventsPerSecondPerPlayer,
          now,
        }),
      };
      player.sockets += 1;
      players.set(playerId, player);
      let released = false;
      return {
        admitted: true,
        release() {
          // A connection closes once, but being careful here keeps the counts right whatever calls it.
          if (released) return;
          released = true;
          add(perSession, sessionId, -1);
          add(perAddress, address, -1);
          player.sockets -= 1;
        },
      };
    },

    /**
     * Takes one event from the player's shared budget.
     *
     * @param {string} playerId  a player with an admitted connection
     * @returns {boolean} false when the budget is used up for now
     */
    allowEvent: (playerId) => players.get(playerId)?.bucket.tryTake() ?? false,

    /** @returns {{ connections: number, players: number }} what is counted right now, for the gauge in the logs */
    counts: () => ({
      connections: [...perSession.values()].reduce((sum, count) => sum + count, 0),
      players: [...players.values()].filter((player) => player.sockets > 0).length,
    }),
  });
}
