import {
  createKeyedIds,
  KEYED_ID_LABELS,
  KEYED_ID_PATTERN,
  keyedIdSecretFrom,
} from "../../utils/keyedIds.js";

/** The shape of every seat id: 22 base64url characters. A player id never has it. */
export const SEAT_ID_PATTERN = KEYED_ID_PATTERN;

/**
 * Seat ids (CC-253, ADR-057). A room view names every player by a seat id instead of their player id. An account's
 * player id holds the time the account was made, and the same player id in every room would let anyone follow a
 * player from room to room.
 *
 * A seat id is a keyed hash of the room and the player (`utils/keyedIds.js`), worked out whenever a view is made, so
 * nothing is stored. The room is its code and the time it was made, which never change in a rematch. So the same
 * player has the same seat id for as long as the room lives, and an unrelated one in any other room, even one that
 * reuses the code later. Without the key nobody can work a seat id out from a player id, or turn it back into one.
 *
 * @param {{ secret: string }} deps  the key, never shown to anyone (see `seatSecretFrom`)
 */
export function createSeatIds({ secret }) {
  const keyedIds = createKeyedIds({ secret });
  return Object.freeze({
    /**
     * The seat id of a player in a room.
     *
     * @param {Readonly<{ code: string, createdAt: number }>} room
     * @param {string} playerId
     * @returns {string}
     */
    seatIdOf: (room, playerId) => keyedIds.idOf([room.code, room.createdAt, playerId]),
  });
}

/**
 * The seat id key, derived from the session secret under the room seats label.
 *
 * @param {string} sessionSecret
 */
export const seatSecretFrom = (sessionSecret) =>
  keyedIdSecretFrom({ sessionSecret, label: KEYED_ID_LABELS.ROOM_SEATS });
