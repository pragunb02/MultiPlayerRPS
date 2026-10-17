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
     * @returns {Promise<ReadonlyArray<Readonly<LegacyUser>>>} every legacy user with that email, or an empty list.
     *   The old app could hold two rows for one address that differ only in case (CC-245).
     */
    async findByEmail(email) {
      const users = await legacyUserDao.listByEmail(email);
      return Object.freeze(users.map((user) => Object.freeze({ ...user })));
    },
  });
}
