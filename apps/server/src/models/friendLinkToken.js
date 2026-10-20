import { createHash, randomBytes } from "node:crypto";

// 16 random bytes are 128 bits, far too many to guess, and 22 characters in base64url.
const TOKEN_BYTES = 16;

/**
 * A new friend link token (CC-052): random bytes from the operating system's generator in base64url, never a
 * player id, a time or a counter, so the link tells nothing about who made it or when.
 *
 * @param {(size: number) => Buffer} [bytes]  for tests only
 * @returns {string}
 */
export const newFriendLinkToken = (bytes = randomBytes) => bytes(TOKEN_BYTES).toString("base64url");

/**
 * What is stored for a token: its SHA-256 in hex. Someone who reads the database cannot use a stored link, because
 * the token cannot be worked out from its hash. Plain SHA-256 is enough here because the token is 128 random bits,
 * not a password a person chose.
 *
 * @param {string} token
 * @returns {string}
 */
export const hashFriendLinkToken = (token) => createHash("sha256").update(token).digest("hex");
