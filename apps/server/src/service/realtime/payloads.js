import { REQUEST_ANSWERS } from "@classicade/shared";
import { parseRoomCode } from "../../models/roomCode.js";
import { ValidationError } from "../../utils/errors.js";

const MAX_OPTIONS_BYTES = 1_024;
const MAX_MOVE_BYTES = 2_048;
const GAME_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
// Request types are short lowercase names such as "rematch" or "draw". Which ones a room knows is a rule of the
// room and its game, checked in the domain.
const REQUEST_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const ANSWERS = new Set(Object.values(REQUEST_ANSWERS));

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/** @param {unknown} raw @param {string[]} allowed */
function requireObject(raw, allowed) {
  if (!isPlainObject(raw)) {
    throw new ValidationError("Payload must be an object");
  }
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError("Unknown fields in payload", { details: { fields: unknown } });
  }
  return raw;
}

function requireSmall(value, maxBytes, field) {
  // Values here come from parsed JSON (never undefined or functions), so they always stringify.
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes) {
    throw new ValidationError(`${field} is too large`, { details: { field } });
  }
}

/**
 * Edge validation for socket payloads: shape, size and types only. Business rules (does the room exist,
 * is it your turn) belong to the domain layer.
 */

/** @returns {{ gameId: string, options: Record<string, unknown> }} */
export function parseCreateRoom(raw) {
  const { gameId, options = {} } = requireObject(raw, ["gameId", "options"]);
  if (typeof gameId !== "string" || !GAME_ID_PATTERN.test(gameId)) {
    throw new ValidationError("Unknown game", { details: { field: "gameId" } });
  }
  if (!isPlainObject(options)) {
    throw new ValidationError("options must be an object", { details: { field: "options" } });
  }
  requireSmall(options, MAX_OPTIONS_BYTES, "options");
  return { gameId, options };
}

/** @returns {{ code: string }} */
export function parseRoomRef(raw) {
  const { code } = requireObject(raw, ["code"]);
  return { code: parseRoomCode(code) };
}

/**
 * Leaving a room. `waitingOnly` asks to leave only while the room still waits for players: the page closing
 * sends it, so a game that started a moment before is never forfeited by it (CC-112).
 *
 * @returns {{ code: string, waitingOnly: boolean }}
 */
export function parseLeaveRoom(raw) {
  const { code, waitingOnly = false } = requireObject(raw, ["code", "waitingOnly"]);
  if (typeof waitingOnly !== "boolean") {
    throw new ValidationError("waitingOnly must be true or false", { details: { field: "waitingOnly" } });
  }
  return { code: parseRoomCode(code), waitingOnly };
}

/** @returns {{ code: string, type: string }} */
export function parseRoomRequest(raw) {
  const { code, type } = requireObject(raw, ["code", "type"]);
  if (typeof type !== "string" || !REQUEST_TYPE_PATTERN.test(type)) {
    throw new ValidationError("Unknown request", { details: { field: "type" } });
  }
  return { code: parseRoomCode(code), type };
}

/** @returns {{ code: string, type: string, answer: string }} */
export function parseRoomAnswer(raw) {
  const { answer, ...request } = requireObject(raw, ["code", "type", "answer"]);
  if (!ANSWERS.has(answer)) {
    throw new ValidationError("Answer accept, decline or withdraw", { details: { field: "answer" } });
  }
  return { ...parseRoomRequest(request), answer };
}

/** @returns {{ code: string, move: unknown }} */
export function parseGameMove(raw) {
  const { code, move } = requireObject(raw, ["code", "move"]);
  if (move === undefined) {
    throw new ValidationError("move is required", { details: { field: "move" } });
  }
  requireSmall(move, MAX_MOVE_BYTES, "move");
  return { code: parseRoomCode(code), move };
}

const LEVEL_PATTERN = /^[a-z][a-z0-9-]{0,15}$/;

/** @returns {{ gameId: string, options: Record<string, unknown>, level: string }} */
export function parsePlayComputer(raw) {
  const { level, ...room } = requireObject(raw, ["gameId", "options", "level"]);
  if (typeof level !== "string" || !LEVEL_PATTERN.test(level)) {
    throw new ValidationError("Pick a level", { details: { field: "level" } });
  }
  return { ...parseCreateRoom(room), level };
}
