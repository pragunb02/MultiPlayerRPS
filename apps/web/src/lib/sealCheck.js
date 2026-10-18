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

/** The throw a revealed move names, or "" when its text is not a move this app can read. */
function choiceIn(text) {
  try {
    return JSON.parse(text).choice ?? "";
  } catch {
    return "";
  }
}

/**
 * What a shown seal proves (CC-225). A matching hash alone proves nothing: the server could make a new lock after
 * seeing the person's throw and send a hash that fits it. So the check counts only when its lock is the very one
 * this browser was shown before the round, and its move is the throw that decided the round.
 *
 * @param {{
 *   lockShown: string,
 *   check: { text: string, commitment: string },
 *   played: string,
 *   hashed: "checking" | "matched" | "mismatched" | "unchecked",
 * }} input  `lockShown` is the lock this browser showed before the round, "" when it saw none (the page was
 *   opened after the round). `played` is the computer's throw in the round's result, "" when no round was played
 *   with it (the game ended first). `hashed` is how the hash of the move and the key came out
 * @returns {"checking" | "matched" | "mismatched" | "unchecked" | "unseen"}
 */
export function sealVerdict({ lockShown, check, played, hashed }) {
  if (lockShown === "") {
    return "unseen";
  }
  if (lockShown !== check.commitment || (played !== "" && choiceIn(check.text) !== played)) {
    return "mismatched";
  }
  return hashed;
}
