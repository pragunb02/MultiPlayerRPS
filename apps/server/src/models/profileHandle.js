import { randomBytes } from "node:crypto";
import { PROFILE_HANDLE_ALPHABET, PROFILE_HANDLE_LENGTH } from "@classicade/shared";

/**
 * A new profile handle (CC-034): 16 letters, each 5 random bits from the operating system's generator. The letters
 * come from random bytes only, never from a player id, a time or a counter, so a handle tells nothing about who
 * owns it or when they joined.
 *
 * @param {(size: number) => Buffer} [bytes]  for tests only
 * @returns {string}
 */
export function newProfileHandle(bytes = randomBytes) {
  // Each byte gives its lowest 5 bits. 256 is a multiple of 32, so every letter is equally likely.
  return [...bytes(PROFILE_HANDLE_LENGTH)]
    .map((byte) => PROFILE_HANDLE_ALPHABET[byte % PROFILE_HANDLE_ALPHABET.length])
    .join("");
}
