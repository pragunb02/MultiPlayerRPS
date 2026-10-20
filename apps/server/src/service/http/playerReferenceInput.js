import { isProfileHandle } from "@classicade/shared";
import { SEAT_ID_PATTERN } from "../../domain/rooms/seatIds.js";
import { parseRoomCode } from "../../models/roomCode.js";
import { ValidationError } from "../../utils/errors.js";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Seats are positions in a room or a match. No game has more than a few players.
const MAX_SEAT = 7;

/**
 * The ways a client can name another player (CC-044): by a seat of an open room, a player of a stored match, a public
 * profile's handle, or a report it made. Never by a player id. Each route lists the kinds it takes.
 */
export const REFERENCE_KIND = Object.freeze({
  ROOM: "roomCode",
  MATCH: "matchId",
  HANDLE: "handle",
  REPORT: "reportId",
});

/** The fields of each kind of reference, its key first. */
const FIELDS = Object.freeze({
  [REFERENCE_KIND.ROOM]: ["roomCode", "seat", "seatId"],
  [REFERENCE_KIND.MATCH]: ["matchId", "seat"],
  [REFERENCE_KIND.HANDLE]: ["handle"],
  [REFERENCE_KIND.REPORT]: ["reportId"],
});

export const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

function parseSeat(seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > MAX_SEAT) {
    throw new ValidationError(`seat must be a whole number from 0 to ${MAX_SEAT}`, {
      details: { field: "seat" },
    });
  }
  return seat;
}

/** How each kind is checked. A malformed handle is refused here; one nobody has is the domain's 404. */
const PARSERS = Object.freeze({
  [REFERENCE_KIND.ROOM](body) {
    const seat = parseSeat(body.seat);
    if (typeof body.seatId !== "string" || !SEAT_ID_PATTERN.test(body.seatId)) {
      throw new ValidationError("Say who sits in that seat", { details: { field: "seatId" } });
    }
    return { roomCode: parseRoomCode(body.roomCode), seat, seatId: body.seatId };
  },
  [REFERENCE_KIND.MATCH](body) {
    const seat = parseSeat(body.seat);
    if (typeof body.matchId !== "string" || !UUID_PATTERN.test(body.matchId)) {
      throw new ValidationError("Invalid match id", { details: { field: "matchId" } });
    }
    return { matchId: body.matchId, seat };
  },
  [REFERENCE_KIND.HANDLE](body) {
    if (!isProfileHandle(body.handle)) {
      throw new ValidationError("Invalid profile handle", { details: { field: "handle" } });
    }
    return { handle: body.handle };
  },
  [REFERENCE_KIND.REPORT](body) {
    if (typeof body.reportId !== "string" || !UUID_PATTERN.test(body.reportId)) {
      throw new ValidationError("Invalid report id", { details: { field: "reportId" } });
    }
    return { reportId: body.reportId };
  },
});

/**
 * Who a request names, and nothing more: exactly one kind of reference from `kinds`, with its own fields, plus the
 * route's `extra` fields. Any other field, a player id included, is refused, so nobody can name a player they never
 * met. A room seat's `seatId` is the opaque id the room view showed (CC-253), so a player id has the wrong shape.
 *
 * @param {unknown} body
 * @param {{ kinds: ReadonlyArray<string>, extra?: ReadonlyArray<string>, message: string }} rules  `kinds` are
 *   REFERENCE_KIND values, the first is the one assumed when none is given. `message` explains the body to send
 * @returns {Readonly<Record<string, unknown>>} the reference, with the field names of its kind
 * @throws {ValidationError}
 */
export function parseReference(body, { kinds, extra = [], message }) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Send a JSON object");
  }
  const kind = kinds.find((key) => key in body) ?? kinds[0];
  const allowed = [...FIELDS[kind], ...extra];
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(message, { details: { fields: unknown } });
  }
  return Object.freeze(PARSERS[kind](body));
}
