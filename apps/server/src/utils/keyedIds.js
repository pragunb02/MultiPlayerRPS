import { createHmac } from "node:crypto";
import { assertDefined } from "./assert.js";

const MIN_SECRET_LENGTH = 32;
// 16 bytes of the hash are 128 bits, far too many to guess or to collide, and 22 characters in base64url.
const ID_BYTES = 16;

/** The shape of every keyed id: 22 base64url characters. A player id never has it. */
export const KEYED_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * One label for each purpose a keyed id is made for. Each label gives its own key, so an id made for one purpose
 * says nothing about the same person's id made for another. A new purpose is a new label here (ADR-057).
 */
export const KEYED_ID_LABELS = Object.freeze({
  /** Players in a room view, a seat id (CC-253). */
  ROOM_SEATS: "classicade room seat ids",
  /** Players in match history, a match player id (CC-297). */
  MATCH_PLAYERS: "classicade match player ids",
  /** A player's bucket for a feature flag, which never leaves the server (CC-312). */
  FLAG_BUCKETS: "classicade feature flag buckets",
});

const LABELS = new Set(Object.values(KEYED_ID_LABELS));

/**
 * Keyed ids (CC-253, CC-297). Instead of a player id, a client is shown an id worked out from the player id and
 * the place it is shown in, under a key only the server has. The same place and player always give the same id, any
 * other place gives an unrelated one, and nobody can work it out or turn it back without the key. Nothing is stored.
 *
 * @param {{ secret: string }} deps  the key, never shown to anyone (see `keyedIdSecretFrom`)
 */
export function createKeyedIds({ secret }) {
  assertDefined(secret, "secret");
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new RangeError(`The keyed id secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return Object.freeze({
    /**
     * The id of a list of parts, such as a room and a player. The parts are written as a JSON list, so no two
     * lists can ever give the same text.
     *
     * @param {ReadonlyArray<string | number>} parts
     * @returns {string}
     */
    idOf: (parts) =>
      createHmac("sha256", secret)
        .update(JSON.stringify(parts))
        .digest()
        .subarray(0, ID_BYTES)
        .toString("base64url"),
  });
}

/**
 * The key for one purpose, derived from the session secret so that no new setting is needed. The label keeps it
 * apart from the session cookies, from the computer player's seals and from every other purpose.
 *
 * @param {{ sessionSecret: string, label: string }} input  `label` is one of `KEYED_ID_LABELS`
 * @returns {string}
 */
export function keyedIdSecretFrom({ sessionSecret, label }) {
  if (!LABELS.has(label)) {
    throw new RangeError("A keyed id label must be one of KEYED_ID_LABELS");
  }
  return createHmac("sha256", sessionSecret).update(label).digest("hex");
}
