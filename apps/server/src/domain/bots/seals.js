import { createHash, createHmac } from "node:crypto";
import { assertDefined } from "../../utils/assert.js";

/**
 * Sealed moves (commit and reveal, CC-225, ADR-025). When a computer player must choose at the same moment as a
 * person (Rock Paper Scissors), it chooses first and the person sees only a lock: the SHA-256 of the move's text, a
 * colon and a secret salt. After the round the move and the salt are shown, so anyone can hash them again and see
 * that the lock matches. The salt is long and secret until then, so the lock gives nothing away, and a different
 * move would give a different lock, so the computer cannot change its mind after seeing the person's choice.
 *
 * @typedef {Readonly<{ text: string, salt: string, commitment: string }>} Seal
 */

/**
 * The lock for a move's text and its salt: lowercase hexadecimal SHA-256 of `text:salt`. Browsers check it the same
 * way.
 *
 * @param {{ text: string, salt: string }} sealed
 * @returns {string}
 */
export const commitmentOf = ({ text, salt }) => createHash("sha256").update(`${text}:${salt}`).digest("hex");

/**
 * Makes seals. The salt is worked out from the server's secret and a key naming the turn, so deciding the same turn
 * twice gives the same seal. That matters because a room change may be decided again when someone else saved first.
 *
 * @param {{ secret: string }} deps  never shown to anyone. Each salt is shown once its round is over, and a salt
 *   does not reveal the secret or any other salt
 */
export function createSealMaker({ secret }) {
  assertDefined(secret, "secret");
  if (secret.length < 32) {
    throw new RangeError("The seal secret must be at least 32 characters");
  }
  return Object.freeze({
    /**
     * @param {{ key: string, text: string }} input  `key` is unique for each turn of each match
     * @returns {Seal}
     */
    seal({ key, text }) {
      const salt = createHmac("sha256", secret).update(key).digest("hex");
      return Object.freeze({ text, salt, commitment: commitmentOf({ text, salt }) });
    },
  });
}

/**
 * The seal secret, derived from the session secret so that no new setting is needed. A separate label keeps the two
 * uses apart: knowing a salt tells nothing about session cookies.
 *
 * @param {string} sessionSecret
 */
export const sealSecretFrom = (sessionSecret) =>
  createHmac("sha256", sessionSecret).update("classicade computer player seals").digest("hex");
