import { createKeyedIds, KEYED_ID_LABELS, keyedIdSecretFrom } from "../../utils/keyedIds.js";

/**
 * Match player ids (CC-297, ADR-057). Match history names every player by an id made for that match instead of
 * their player id. An account's player id holds the time the account was made, and the same player id in every match
 * would let a player, or two players comparing their histories, follow one opponent from match to match.
 *
 * A match player id is a keyed hash of the match and the player (`utils/keyedIds.js`), worked out on every read, so
 * nothing is stored and no stored match needs changing. Both players of a match see the same ids for it, and an
 * unrelated id in every other match. Its key is not the seat ids' key, so it is also unrelated to the seat id the
 * same player had in the room the match was played in.
 *
 * @param {{ secret: string }} deps  the key, never shown to anyone (see `matchPlayerSecretFrom`)
 */
export function createMatchPlayerIds({ secret }) {
  const keyedIds = createKeyedIds({ secret });
  return Object.freeze({
    /**
     * The id of a player in a match.
     *
     * @param {Readonly<{ matchId: string }>} match
     * @param {string} playerId
     * @returns {string}
     */
    playerIdIn: (match, playerId) => keyedIds.idOf([match.matchId, playerId]),
  });
}

/**
 * The match player id key, derived from the session secret under the match players label.
 *
 * @param {string} sessionSecret
 */
export const matchPlayerSecretFrom = (sessionSecret) =>
  keyedIdSecretFrom({ sessionSecret, label: KEYED_ID_LABELS.MATCH_PLAYERS });
