import { randomBytes } from "node:crypto";
import { PROFILE_HANDLE_ALPHABET, PROFILE_HANDLE_LENGTH } from "@classicade/shared";

const LOW_FIVE_BITS = 0b11111;

/**
 * A new profile handle (CC-034): 16 letters, each 5 random bits from the operating system's generator. The letters
 * come from random bytes only, never from a player id, a time or a counter, so a handle tells nothing about who
 * owns it or when they joined.
 *
 * @param {(size: number) => Buffer} [bytes]  for tests only
 * @returns {string}
 */
export function newProfileHandle(bytes = randomBytes) {
  // Each byte gives its lowest 5 bits, so every one of the 32 letters is equally likely.
  return [...bytes(PROFILE_HANDLE_LENGTH)]
    .map((byte) => PROFILE_HANDLE_ALPHABET[byte & LOW_FIVE_BITS])
    .join("");
}
