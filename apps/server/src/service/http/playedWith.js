import { parseReference, REFERENCE_KIND, UUID_PATTERN } from "./playerReferenceInput.js";

/** The shape of a match id and of every other random id the server makes with `randomUUID`. */
export { UUID_PATTERN };

/**
 * Someone the caller played with, as blocks (CC-044) and friend requests (CC-052) name them: `{ roomCode, seat,
 * seatId }` or `{ matchId, seat }`, and nothing else. A player id alone is never enough: `seatId` only confirms who
 * the page saw in that seat of a room the caller sits in. It is the opaque seat id of the room view (CC-253), so a
 * player id has the wrong shape and is refused here. So nobody can name a player they never met. The checks are
 * the ones every reference shares (playerReferenceInput.js), so reports (ADR-071) check these the same way.
 *
 * @param {unknown} body
 * @returns {import("../../domain/players/coPlayers.js").PlayedWith}
 * @throws {import("../../utils/errors.js").ValidationError} for anything else
 */
export const parsePlayedWith = (body) =>
  /** @type {import("../../domain/players/coPlayers.js").PlayedWith} */ (
    parseReference(body, {
      kinds: [REFERENCE_KIND.MATCH, REFERENCE_KIND.ROOM],
      message: "Send a room code or a match id, and a seat",
    })
  );
