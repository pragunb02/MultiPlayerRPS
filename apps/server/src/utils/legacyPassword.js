import bcrypt from "bcryptjs";

const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/;

/**
 * Checks a password against a legacy bcrypt hash (the old app used bcrypt/bcryptjs). Used only while migrating a
 * legacy account at its first login; the password is then re-hashed with scrypt (utils/passwordHasher).
 *
 * @param {string} password
 * @param {string} legacyHash
 * @returns {Promise<boolean>} false for anything that is not a bcrypt hash
 */
export async function verifyLegacyPassword(password, legacyHash) {
  if (typeof legacyHash !== "string" || !BCRYPT_PREFIX.test(legacyHash)) {
    return false;
  }
  try {
    return await bcrypt.compare(password, legacyHash);
  } catch {
    return false;
  }
}
