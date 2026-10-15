import { randomInt, randomUUID } from "node:crypto";
import { IDENTITY_KINDS } from "@classicade/shared";
import { createIdentity } from "../../models/identity.js";
import { assertFunction } from "../../utils/assert.js";

// No 0/O or 1/I, so names are easy to read out loud to a friend.
const GUEST_SUFFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GUEST_SUFFIX_LENGTH = 4;

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

  return Object.freeze({
    /**
     * A new guest: anyone can play without an account; the identity lives in their session.
     * @returns {Readonly<import("../../models/identity.js").Identity>}
     */
    createGuest() {
      return createIdentity({
        kind: IDENTITY_KINDS.GUEST,
        id: `guest_${generateId()}`,
        displayName: `Guest-${generateGuestSuffix()}`,
      });
    },
  });
}
