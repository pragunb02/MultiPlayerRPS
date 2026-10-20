import { randomBytes } from "node:crypto";
import { CHALLENGE_ID_LENGTH, PROFILE_HANDLE_ALPHABET } from "@classicade/shared";

const LOW_FIVE_BITS = 0b11111;

/**
 * A new challenge id (CC-139): 20 letters, each 5 random bits from the operating system's generator, 100 bits in
 * all. It comes from random bytes only, never from a player id, a time or a counter, so the link tells nothing about
 * who made it or when.
 *
 * @param {(size: number) => Buffer} [bytes]  for tests only
 * @returns {string}
 */
export function newChallengeId(bytes = randomBytes) {
  // Each byte gives its lowest 5 bits, so every one of the 32 letters is equally likely.
  return [...bytes(CHALLENGE_ID_LENGTH)]
    .map((byte) => PROFILE_HANDLE_ALPHABET[byte & LOW_FIVE_BITS])
    .join("");
}
