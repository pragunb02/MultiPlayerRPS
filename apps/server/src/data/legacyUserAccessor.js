import { aliasesOf } from "../models/credentials.js";
import { assertDefined } from "../utils/assert.js";

/**
 * @typedef {{ username: string, email: string, passwordHash: string }} LegacyUser
 */

/** @param {{ legacyUserDao: ReturnType<typeof import("../persistence/legacyUserDao.js").createLegacyUserDao> }} deps */
export function createLegacyUserAccessor({ legacyUserDao }) {
  assertDefined(legacyUserDao, "legacyUserDao");
  /** @type {Map<string, string[]>} filled once at boot by `loadEmailAliases`. The collection never changes. */
  let aliases = new Map();

  return Object.freeze({
    /**
     * Reads which legacy emails are stored in a spelling the one email spelling changes, so the lookup can still
     * find them. The legacy collection is read-only, so this is read once, at boot.
     *
     * @returns {Promise<number>} how many legacy rows have such an email
     */
    async loadEmailAliases() {
      aliases = aliasesOf(await legacyUserDao.listNonAsciiEmails(), (email) => email.trim().toLowerCase());
      return [...aliases.values()].reduce((count, stored) => count + stored.length, 0);
    },

    /**
     * @param {string} email  normalised
     * @returns {Promise<ReadonlyArray<Readonly<LegacyUser>>>} every legacy user with that email, oldest first, or
     *   an empty list. The old app could hold two rows for one address that differ only in case (CC-245).
     */
    async findByEmail(email) {
      const users = await legacyUserDao.listByEmail(email, aliases.get(email) ?? []);
      return Object.freeze(users.map((user) => Object.freeze({ ...user })));
    },
  });
}
