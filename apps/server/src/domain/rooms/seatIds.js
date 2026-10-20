import { createHmac } from "node:crypto";
import { assertDefined } from "../../utils/assert.js";

const MIN_SECRET_LENGTH = 32;
// 16 bytes of the hash are 128 bits, far too many to guess or to collide, and 22 characters in base64url.
const SEAT_ID_BYTES = 16;

/** The shape of every seat id: 22 base64url characters. A player id never has it. */
export const SEAT_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * Seat ids (CC-253, ADR-057). A room view names every player by a seat id instead of their player id. An account's
 * player id holds the time the account was made, and the same player id in every room would let anyone follow a
 * player from room to room.
 *
 * A seat id is a keyed hash of the room and the player, worked out whenever a view is made, so nothing is stored.
 * The room is its code and the time it was made, which never change in a rematch. So the same player has the same
 * seat id for as long as the room lives, and an unrelated one in any other room, even one that reuses the code
 * later. Without the key nobody can work a seat id out from a player id, or turn it back into one.
 *
 * @param {{ secret: string }} deps  the key, never shown to anyone (see `seatSecretFrom`)
 */
export function createSeatIds({ secret }) {
  assertDefined(secret, "secret");
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new RangeError(`The seat id secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return Object.freeze({
    /**
     * The seat id of a player in a room. The input is written as a JSON list, so no two rooms and players can
     * ever give the same text.
     *
     * @param {Readonly<{ code: string, createdAt: number }>} room
     * @param {string} playerId
     * @returns {string}
     */
    seatIdOf: (room, playerId) =>
      createHmac("sha256", secret)
        .update(JSON.stringify([room.code, room.createdAt, playerId]))
        .digest()
        .subarray(0, SEAT_ID_BYTES)
        .toString("base64url"),
  });
}

/**
 * The seat id key, derived from the session secret so that no new setting is needed. Its own label keeps it apart
 * from the session cookies and from the computer player's seals.
 *
 * @param {string} sessionSecret
 */
export const seatSecretFrom = (sessionSecret) =>
  createHmac("sha256", sessionSecret).update("classicade room seat ids").digest("hex");
