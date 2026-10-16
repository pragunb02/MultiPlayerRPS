import { assertDefined } from "../utils/assert.js";

/**
 * @typedef {Object} Progress   domain model (frozen); a player with no games yet has all-zero progress
 * @property {string} playerId
 * @property {number} xp
 * @property {number} matchesPlayed
 * @property {number} wins
 * @property {number} losses
 * @property {number} draws
 */

const ZERO = Object.freeze({ xp: 0, matchesPlayed: 0, wins: 0, losses: 0, draws: 0 });

/**
 * @param {{ progressDao: ReturnType<typeof import("../persistence/progressDao.js").createProgressDao> }} deps
 */
export function createProgressAccessor({ progressDao }) {
  assertDefined(progressDao, "progressDao");

  return Object.freeze({
    /**
     * @param {string} playerId
     * @returns {Promise<Readonly<Progress>>}
     */
    async get(playerId) {
      try {
        const { updatedAt, ...totals } = await progressDao.getByPlayer(playerId);
        return Object.freeze({ ...totals });
      } catch (err) {
        if (err instanceof RangeError) {
          return Object.freeze({ playerId, ...ZERO });
        }
        throw err;
      }
    },

    /**
     * Adds one match to a player's totals, at most once per match.
     *
     * @param {{ playerId: string, matchId: string, inc: Partial<Omit<Progress, "playerId">>, at: number }} change
     * @returns {Promise<{ applied: boolean, before: Readonly<Progress>, after: Readonly<Progress> }>}
     */
    async applyMatchOnce({ playerId, matchId, inc, at }) {
      const { applied, before } = await progressDao.applyMatchOnce({
        playerId,
        matchId,
        inc,
        at: new Date(at),
      });
      const after = applied
        ? Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value + (inc[key] ?? 0)]))
        : before;
      return {
        applied,
        before: Object.freeze({ playerId, ...before }),
        after: Object.freeze({ playerId, ...after }),
      };
    },
  });
}
