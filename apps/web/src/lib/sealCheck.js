/**
 * Checks a computer player's sealed move after it was shown (CC-225). The server showed a lock before the round:
 * the SHA-256 of the move's text, a colon and a secret salt. Now it shows the text and the salt. Hashing them here,
 * in the player's own browser, and getting the same lock proves the move was chosen before the player's.
 *
 * @param {{ text: string, salt: string, commitment: string }} check  one of the RoomView's `fairness.checks`
 * @param {Pick<SubtleCrypto, "digest">} [subtle]  the browser's own, given only by tests
 * @returns {Promise<boolean>} whether the lock matches
 * @throws {Error} when the browser cannot hash (a page served without HTTPS has no `crypto.subtle`)
 */
export async function checkSeal({ text, salt, commitment }, subtle = globalThis.crypto?.subtle) {
  if (subtle === undefined) {
    throw new Error("This browser cannot check the lock");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(`${text}:${salt}`));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex === commitment;
}

/** The start and the end of a lock, short enough to read: `7f3a…c21`. */
export const shortLock = (commitment) => `${commitment.slice(0, 4)}…${commitment.slice(-3)}`;
