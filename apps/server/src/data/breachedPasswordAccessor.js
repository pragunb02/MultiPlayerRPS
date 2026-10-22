import { createHash } from "node:crypto";
import { PWNED_PASSWORDS_PREFIX_LENGTH as PREFIX_LENGTH } from "../dependency/pwnedPasswords/pwnedPasswordsClient.js";
import { assertDefined } from "../utils/assert.js";

/**
 * Whether a password is known to attackers (CC-261, ADR-080), from two sources: the bundled common password list,
 * and Have I Been Pwned's breached passwords. For the second, only the first five characters of the password's
 * SHA-1 leave the server (k-anonymity). The rest of the hash is compared here, so neither the password nor its
 * full hash is ever sent.
 *
 * @param {{
 *   pwnedPasswords: Pick<ReturnType<typeof import("../dependency/pwnedPasswords/pwnedPasswordsClient.js").createPwnedPasswordsClient>, "rangeOf">,
 *   commonPasswords: Pick<ReturnType<typeof import("../persistence/commonPasswords.js").loadCommonPasswords>, "has">,
 * }} deps
 */
export function createBreachedPasswordAccessor({ pwnedPasswords, commonPasswords }) {
  assertDefined(pwnedPasswords, "pwnedPasswords");
  assertDefined(commonPasswords, "commonPasswords");

  return Object.freeze({
    /**
     * Whether the password is on the common password list, in any capitals.
     *
     * @param {string} password
     */
    isCommon: (password) => commonPasswords.has(password.toLowerCase()),

    /**
     * Whether the password was seen in a breach. A suffix that is only padding has a count of 0 and does not count.
     *
     * @param {string} password
     * @returns {Promise<boolean>}
     * @throws {Error} when the service cannot answer, so the caller decides what that means
     */
    async isBreached(password) {
      // SHA-1 is what the HIBP range API requires. It is only a lookup key and is never stored (passwordHasher does that).
      const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
      const range = await pwnedPasswords.rangeOf(sha1.slice(0, PREFIX_LENGTH));
      return (range.get(sha1.slice(PREFIX_LENGTH)) ?? 0) > 0;
    },
  });
}
