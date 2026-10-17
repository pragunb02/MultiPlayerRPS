import { randomInt, randomUUID } from "node:crypto";
import { IDENTITY_KINDS } from "@classicade/shared";
import { createIdentity } from "../../models/identity.js";
import { isOffensiveName, isReservedName } from "../../models/publicName.js";
import { assertFunction } from "../../utils/assert.js";

// No 0/O or 1/I, so names are easy to read out loud to a friend.
const GUEST_SUFFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GUEST_SUFFIX_LENGTH = 4;
// Random letters can spell a rude word or a bot name. A clean draw is almost certain within a few tries.
const GUEST_SUFFIX_ATTEMPTS = 20;

const randomGuestSuffix = () =>
  Array.from(
    { length: GUEST_SUFFIX_LENGTH },
    () => GUEST_SUFFIX_ALPHABET[randomInt(GUEST_SUFFIX_ALPHABET.length)],
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
