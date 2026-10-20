import { SEAT_ID_PATTERN } from "../../domain/rooms/seatIds.js";
import { parseRoomCode } from "../../models/roomCode.js";
import { ValidationError } from "../../utils/errors.js";

/** The shape of a match id and of every other random id the server makes with `randomUUID`. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Seats are positions in a room or a match. No game has more than a few players.
const MAX_SEAT = 7;

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * Someone the caller played with, as blocks (CC-044) and friend requests (CC-052) name them: `{ roomCode, seat,
 * seatId }` or `{ matchId, seat }`, and nothing else. A player id alone is never enough: `seatId` only confirms who
 * the page saw in that seat of a room the caller sits in. It is the opaque seat id of the room view (CC-253), so a
 * player id has the wrong shape and is refused here. So nobody can name a player they never met.
 *
 * @param {unknown} body
 * @returns {import("../../domain/players/coPlayers.js").PlayedWith}
 * @throws {ValidationError} for anything else
 */
export function parsePlayedWith(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Send a JSON object");
  }
  const reference = "roomCode" in body ? "roomCode" : "matchId";
  const fields = reference === "roomCode" ? ["roomCode", "seat", "seatId"] : ["matchId", "seat"];
  const unknown = Object.keys(body).filter((key) => !fields.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError("Send a room code or a match id, and a seat", { details: { fields: unknown } });
  }
  const { seat } = body;
  if (!Number.isInteger(seat) || seat < 0 || seat > MAX_SEAT) {
    throw new ValidationError(`seat must be a whole number from 0 to ${MAX_SEAT}`, {
      details: { field: "seat" },
    });
  }
  if (reference === "roomCode") {
    if (typeof body.seatId !== "string" || !SEAT_ID_PATTERN.test(body.seatId)) {
      throw new ValidationError("Say who sits in that seat", { details: { field: "seatId" } });
    }
    return { roomCode: parseRoomCode(body.roomCode), seat, seatId: body.seatId };
  }
  if (typeof body.matchId !== "string" || !UUID_PATTERN.test(body.matchId)) {
    throw new ValidationError("Invalid match id", { details: { field: "matchId" } });
  }
  return { matchId: body.matchId, seat };
}
