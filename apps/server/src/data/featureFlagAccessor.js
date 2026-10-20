import { assertDefined } from "../utils/assert.js";

/**
 * @typedef {Object} FlagOverride      domain model (frozen, times in ms): the owner's rollout for one flag
 * @property {string} name
 * @property {"off" | "on" | number} rollout
 * @property {number} updatedAt
 *
 * @typedef {Object} FlagCounts        the numbers of one side of one flag, summed over days. No id of anyone
 * @property {string} flag
 * @property {"on" | "off"} side
 * @property {number} exposures
 * @property {number} successes
 */

const toOverride = ({ name, rollout, updatedAt }) =>
  Object.freeze({ name, rollout, updatedAt: updatedAt.getTime() });

/**
 * Provides feature flag overrides and counts to the domain (CC-312, ADR-073).
 *
 * @param {{ featureFlagDao: ReturnType<typeof import("../persistence/featureFlagDao.js").createFeatureFlagDao> }} deps
 */
export function createFeatureFlagAccessor({ featureFlagDao }) {
  assertDefined(featureFlagDao, "featureFlagDao");

  return Object.freeze({
    /** @returns {Promise<ReadonlyArray<Readonly<FlagOverride>>>} every stored override, as stored */
    listOverrides: async () => Object.freeze((await featureFlagDao.listOverrides()).map(toOverride)),

    /**
     * @param {{ name: string, rollout: "off" | "on" | number, at: number }} change
     * @returns {Promise<Readonly<FlagOverride>>}
     */
    setOverride: async ({ name, rollout, at }) =>
      toOverride(await featureFlagDao.setOverride({ name, rollout, updatedAt: new Date(at) })),

    /**
     * @param {string} name
     * @returns {Promise<boolean>} whether there was an override to clear
     */
    clearOverride: async (name) => (await featureFlagDao.clearOverride(name)) > 0,

    /**
     * Adds counts to their days.
     *
     * @param {ReadonlyArray<{ flag: string, day: string, side: string, exposures: number, successes: number, expiresAt: number }>} rows
     */
    addCounts: (rows) =>
      featureFlagDao.addCounts(rows.map((row) => ({ ...row, expiresAt: new Date(row.expiresAt) }))),

    /**
     * @param {string} fromDay  the first India day to count, YYYY-MM-DD
     * @returns {Promise<ReadonlyArray<Readonly<FlagCounts>>>}
     */
    countsSince: async (fromDay) =>
      Object.freeze((await featureFlagDao.countsSince(fromDay)).map((row) => Object.freeze({ ...row }))),
  });
}
