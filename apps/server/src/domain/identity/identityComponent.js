import { randomInt, randomUUID } from "node:crypto";
import { IDENTITY_KINDS } from "@classicade/shared";
import { createIdentity, GUEST_NAME_ALPHABET, GUEST_NAME_SUFFIX_LENGTH } from "../../models/identity.js";
import { isOffensiveName, isReservedName } from "../../models/publicName.js";
import { assertFunction } from "../../utils/assert.js";

// Random letters can spell a rude word or a bot name. A clean draw is almost certain within a few tries.
const GUEST_SUFFIX_ATTEMPTS = 20;

const randomGuestSuffix = () =>
  Array.from(
    { length: GUEST_NAME_SUFFIX_LENGTH },
    () => GUEST_NAME_ALPHABET[randomInt(GUEST_NAME_ALPHABET.length)],
  ).join("");

/**
 * Business rules for player identities.
 *
 * @param {{ generateId?: () => string, generateGuestSuffix?: () => string }} [deps]
 *   generators are injectable so tests are deterministic.
 */
export function createIdentityComponent({
  generateId = randomUUID,
  generateGuestSuffix = randomGuestSuffix,
} = {}) {
  assertFunction(generateId, "generateId");
  assertFunction(generateGuestSuffix, "generateGuestSuffix");

  function cleanGuestSuffix() {
    for (let attempt = 0; attempt < GUEST_SUFFIX_ATTEMPTS; attempt += 1) {
      const suffix = generateGuestSuffix();
      if (!isReservedName(suffix) && !isOffensiveName(suffix)) {
        return suffix;
      }
    }
    throw new Error(`No suitable guest name after ${GUEST_SUFFIX_ATTEMPTS} attempts`);
  }

  return Object.freeze({
    /**
     * A new guest: anyone can play without an account; the identity lives in their session.
     * @returns {Readonly<import("../../models/identity.js").Identity>}
     */
    createGuest() {
      return createIdentity({
        kind: IDENTITY_KINDS.GUEST,
        id: `guest_${generateId()}`,
        displayName: `Guest-${cleanGuestSuffix()}`,
      });
    },
  });
}
