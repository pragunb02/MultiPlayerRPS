import { assertDefined } from "../utils/assert.js";

/**
 * @typedef {{ username: string, email: string, passwordHash: string }} LegacyUser
 */

/** @param {{ legacyUserDao: ReturnType<typeof import("../persistence/legacyUserDao.js").createLegacyUserDao> }} deps */
export function createLegacyUserAccessor({ legacyUserDao }) {
  assertDefined(legacyUserDao, "legacyUserDao");

  return Object.freeze({
    /**
     * @param {string} email  normalised
     * @returns {Promise<ReadonlyArray<Readonly<LegacyUser>>>} the legacy user, or an empty list
     */
    async findByEmail(email) {
      try {
        return [Object.freeze(await legacyUserDao.getByEmail(email))];
      } catch (err) {
        if (err instanceof RangeError) {
          return [];
        }
        throw err;
      }
    },
  });
}
