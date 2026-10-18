import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/;

/** The bcrypt cost the old app hashed every password with (`bcrypt.hash(password, 10)`). */
export const LEGACY_BCRYPT_COST = 10;

/**
 * Checks passwords against the old app's bcrypt hashes. Used only while migrating a legacy account at its first
 * login. The password is then hashed again with scrypt (utils/passwordHasher).
 *
 * Every check runs exactly one bcrypt comparison, also when the row has no usable hash or there is no row at all
 * (`verifyAgainstDummy`), so the time a login takes does not say whether an email belonged to a player of the old
 * app (CC-245).
 *
 * @param {{ dummyCost?: number }} [options]  the cost of the dummy hash. Tests pass a low one for speed.
 */
export function createLegacyPasswordChecker({ dummyCost = LEGACY_BCRYPT_COST } = {}) {
  /** @type {Promise<string> | undefined} made at the first check that needs it, so boot does not wait */
  let dummy;
  const dummyHash = () => (dummy ??= bcrypt.hash(randomBytes(32).toString("hex"), dummyCost));

  // bcrypt throws only for arguments that are not text, so the password is made text first. A hash of the wrong
  // length answers false.
  const compare = (password, hash) => bcrypt.compare(typeof password === "string" ? password : "", hash);

  /** Spends the same effort as a real check and always fails. */
  async function verifyAgainstDummy(password) {
    await compare(password, await dummyHash());
    return false;
  }

  return Object.freeze({
    /**
     * @param {unknown} password
     * @param {unknown} legacyHash
     * @returns {Promise<boolean>} false for anything that is not a bcrypt hash
     */
    async verify(password, legacyHash) {
      if (typeof legacyHash !== "string" || !BCRYPT_PREFIX.test(legacyHash)) {
        return verifyAgainstDummy(password);
      }
      return compare(password, legacyHash);
    },

    verifyAgainstDummy,
  });
}
