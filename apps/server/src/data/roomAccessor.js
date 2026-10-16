import { ConflictError, NotFoundError } from "../utils/errors.js";
import { assertDefined } from "../utils/assert.js";
import { DuplicateKey, VersionConflict } from "../persistence/inMemoryRoomDao.js";

/**
 * @typedef {Object} Seat
 * @property {string} playerId
 * @property {string} displayName
 * @property {boolean} connected
 *
 * @typedef {Object} Room              a domain model: deeply frozen, changed only by producing a new room
 * @property {string} code
 * @property {string} gameId
 * @property {Readonly<Record<string, unknown>>} options
 * @property {"waiting" | "playing" | "finished"} status
 * @property {string} hostId
 * @property {ReadonlyArray<Readonly<Seat>>} seats
 * @property {{ seed: number, state: unknown }} [game]   present once the game has started
 * @property {Readonly<{ status: string, result: string, winners: string[], reason: string }>} [result]  final outcome once finished (played out or forfeited)
 * @property {number} createdAt
 * @property {number} lastActivityAt
 * @property {number} version            optimistic-concurrency token owned by the store
 */

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** @returns {Readonly<Room>} */
const toRoom = (doc) => deepFreeze(doc);

/**
 * Provides rooms to the domain layer and hides how they are stored.
 *
 * @param {{ roomDao: ReturnType<typeof import("../persistence/inMemoryRoomDao.js").createInMemoryRoomDao> }} deps
 */
export function createRoomAccessor({ roomDao }) {
  assertDefined(roomDao, "roomDao");

  return Object.freeze({
    /** @param {string} code */
    exists: (code) => roomDao.has(code),

    /**
     * @param {string} code
     * @returns {Readonly<Room>}
     * @throws {NotFoundError}
     */
    getByCode(code) {
      if (!roomDao.has(code)) {
        throw new NotFoundError("Room not found");
      }
      return toRoom(roomDao.get(code));
    },

    /**
     * @param {Omit<Room, "version">} room
     * @returns {Readonly<Room>}
     * @throws {ConflictError} when the code is already taken
     */
    create(room) {
      try {
        return toRoom(roomDao.insert(room));
      } catch (err) {
        if (err instanceof DuplicateKey) {
          throw new ConflictError("Room code already in use", { cause: err });
        }
        throw err;
      }
    },

    /**
     * Saves a changed room. `room.version` must be the version that was read.
     *
     * @param {Room} room
     * @returns {Readonly<Room>}
     * @throws {ConflictError} when the room changed in the meantime
     * @throws {NotFoundError} when the room no longer exists
     */
    save(room) {
      if (!roomDao.has(room.code)) {
        throw new NotFoundError("Room not found");
      }
      try {
        return toRoom(roomDao.update(room));
      } catch (err) {
        if (err instanceof VersionConflict) {
          throw new ConflictError("The room changed, please retry", { cause: err });
        }
        throw err;
      }
    },

    /** @param {string} code */
    remove: (code) => roomDao.delete(code),

    /** @returns {ReadonlyArray<Readonly<Room>>} */
    listAll: () => Object.freeze(roomDao.list().map(toRoom)),
  });
}
