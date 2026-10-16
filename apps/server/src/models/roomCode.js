import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@classicade/shared";
import { ValidationError } from "../utils/errors.js";

const PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * Normalises (trim, upper-case) and validates a room code typed or pasted by a player.
 *
 * @param {unknown} raw
 * @returns {string} a valid room code
 * @throws {ValidationError}
 */
export function parseRoomCode(raw) {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!PATTERN.test(code)) {
    throw new ValidationError(`Room codes are ${ROOM_CODE_LENGTH} letters/digits`, {
      details: { field: "code" },
    });
  }
  return code;
}
