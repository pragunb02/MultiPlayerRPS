import { DuplicateKey } from "../persistence/errors.js";
import { assertDefined } from "../utils/assert.js";
import { ConflictError } from "../utils/errors.js";

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

  /** Marks the guest's progress as moved; a guest already moved to someone else is a conflict. */
  async function markMerged({ from, to, at }) {
    try {
      return await progressDao.markMergedInto({ from, to, at });
    } catch (err) {
      if (err instanceof DuplicateKey) {
        throw new ConflictError("This guest's progress already moved to another player", { cause: err });
      }
      throw err;
    }
  }

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
     * Adds one match to a player's totals, at most once per match. A guest whose progress has moved to an
     * account (CC-032) — a match that finished while they were signing in — counts for that account instead:
     * the answer then carries the account's id and totals.
     *
     * @param {{ playerId: string, matchId: string, inc: Partial<Omit<Progress, "playerId">>, at: number }} change
     * @returns {Promise<{ applied: boolean, before: Readonly<Progress>, after: Readonly<Progress> }>}
     */
    async applyMatchOnce({ playerId, matchId, inc, at }) {
      const change = { matchId, inc, at: new Date(at) };
      const first = await progressDao.applyMatchOnce({ playerId, ...change });
      const owner = first.mergedInto ?? playerId;
      const { applied, before } =
        owner === playerId ? first : await progressDao.applyMatchOnce({ playerId: owner, ...change });
      const after = applied
        ? Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value + (inc[key] ?? 0)]))
        : before;
      return {
        applied,
        before: Object.freeze({ playerId: owner, ...before }),
        after: Object.freeze({ playerId: owner, ...after }),
      };
    },

    /**
     * Moves a guest's totals into an account, exactly once (CC-032). Each step is idempotent, so running it
     * again — after a crash, or concurrently — never adds anything twice.
     *
     * @param {{ from: string, to: string, at: number }} merge
     * @returns {Promise<{ moved: Readonly<Omit<Progress, "playerId">> }>} what was added now (zero when already done)
     * @throws {ConflictError} when the guest's progress already moved to a different player
     */
    async mergeInto({ from, to, at }) {
      const when = new Date(at);
      const { totals, recentMatchIds } = await markMerged({ from, to, at: when });
      const { applied } = await progressDao.addMerged({ to, from, totals, recentMatchIds, at: when });
      return { moved: Object.freeze(applied ? { ...totals } : { ...ZERO }) };
    },
  });
}
