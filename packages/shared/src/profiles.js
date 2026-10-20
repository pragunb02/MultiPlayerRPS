/**
 * Public profiles (CC-034, ADR-065). A profile is reached by its handle, a random address made for it and stored with
 * it. A handle is never a player id, is not worked out from one, and says nothing about rooms or matches.
 */

/** Who can see a profile. Only an adult's profile can ever be public (ADR-048.10, ADR-028). */
export const PROFILE_VISIBILITY = Object.freeze({ PUBLIC: "public", PRIVATE: "private" });

/**
 * Every profile starts private: nothing about a person is shown to everyone until they choose it (GDPR Article
 * 25(2), the ICO children's code standard 7). The owner may change this (ADR-065, owner decision 1).
 */
export const DEFAULT_PROFILE_VISIBILITY = PROFILE_VISIBILITY.PRIVATE;

/** The letters of a handle: Crockford's base 32 in lower case, without `i`, `l`, `o` and `u`. */
export const PROFILE_HANDLE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** 16 letters of 5 bits each, 80 random bits: far too many to guess or count through. */
export const PROFILE_HANDLE_LENGTH = 16;

/** The shape of every handle. A player id never has it: those start with a word and an underscore. */
export const PROFILE_HANDLE_PATTERN = new RegExp(`^[${PROFILE_HANDLE_ALPHABET}]{${PROFILE_HANDLE_LENGTH}}$`);

/** @param {unknown} value */
export const isProfileHandle = (value) => typeof value === "string" && PROFILE_HANDLE_PATTERN.test(value);
