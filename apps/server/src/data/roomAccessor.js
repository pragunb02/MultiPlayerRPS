import { ConcurrentChangeError, ConflictError, NotFoundError } from "../utils/errors.js";
import { assertDefined } from "../utils/assert.js";
import { DuplicateKey, VersionConflict } from "../persistence/errors.js";

/**
 * @typedef {Object} Seat
 * @property {string} playerId
 * @property {string} displayName
 * @property {boolean} connected
 *
 * @typedef {{ kind: "move", playerId: string, move: unknown, at: number }
 *   | { kind: "forfeit", playerId: string, at: number }
 *   | { kind: "expire", at: number }} LogEntry   every state change, in order, with server time
 *
 * @typedef {Object} Room              a domain model: deeply frozen, changed only by producing a new room
 * @property {string} code
 * @property {string} gameId
 * @property {Readonly<Record<string, unknown>>} options
 * @property {"waiting" | "playing" | "finished"} status
 * @property {string} hostId
 * @property {ReadonlyArray<Readonly<Seat>>} seats
 * @property {{ matchId: string, seed: number, startedAt: number, state: unknown, log: ReadonlyArray<LogEntry> }} [game]
 *   present once the game has started; `seed` + `log` reproduce the game exactly (see replayGame)
 * @property {Readonly<{ status: string, result: string, winners: string[], reason: string }>} [result]  final outcome once finished (played out or forfeited)
 * @property {number} [finishedAt]      when the last game ended, the rematch window counts from here (CC-101)
 * @property {Readonly<{ requestedBy: ReadonlyArray<string>, available: boolean, declinedBy: string, leftName?: string }>} [rematch]
 *   once finished: who asked to play again, whether that is still possible (CC-037), who last declined (CC-104),
 *   and the name of a player who left the finished game (CC-162)
 * @property {Readonly<{ games: number, wins: Readonly<Record<string, number>> }>} [series]  games finished in this room
 *   and wins per player, across rematches
 * @property {number} createdAt
 * @property {number} lastActivityAt
 * @property {number} dueAt              when the running game's next deadline falls, 0 for none (kept so the
 *   every second check asks storage for due rooms only)
 * @property {number} expiresAt          when the room's lifetime ends (see roomLifetimes.js)
 * @property {number} version            optimistic-concurrency token owned by the store
 *
 * @typedef {{ code: string, gameId: string, reason: string, closedAt: number }} ClosedRoom   what is left of a
 *   closed room, so whoever comes back learns why it is gone
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
const toRooms = (docs) => Object.freeze(docs.map(toRoom));

/** Storage reports "not there" as a RangeError. The domain hears NotFoundError. */
async function orNotFound(read, message) {
  try {
    return await read();
  } catch (err) {
    if (err instanceof RangeError) {
      throw new NotFoundError(message, { cause: err });
    }
    throw err;
  }
}

/** Storage reports a write from an old version as VersionConflict. The domain hears ConcurrentChangeError. */
async function orConcurrentChange(write) {
  try {
    return await orNotFound(write, "Room not found");
  } catch (err) {
    if (err instanceof VersionConflict) {
      throw new ConcurrentChangeError("The room changed, please retry", { cause: err });
    }
    throw err;
  }
}

/**
 * Provides rooms to the domain layer and hides how they are stored.
 *
 * @param {{ roomDao: ReturnType<typeof import("../persistence/roomDao.js").createRoomDao> }} deps
 */
export function createRoomAccessor({ roomDao }) {
  assertDefined(roomDao, "roomDao");

  return Object.freeze({
    /** @param {string} code */
    exists: (code) => roomDao.has(code),

    /** @param {string} code  whether a room with this code closed recently (its record is still kept) */
    wasClosed: (code) => roomDao.hasClosed(code),

    /**
     * @param {string} code
     * @returns {Promise<Readonly<Room>>}
     * @throws {NotFoundError}
     */
    getByCode: async (code) => toRoom(await orNotFound(() => roomDao.get(code), "Room not found")),

    /**
     * @param {string} code
     * @returns {Promise<Readonly<ClosedRoom>>}
     * @throws {NotFoundError} when no record of it is kept
     */
    getClosed: async (code) => toRoom(await orNotFound(() => roomDao.getClosed(code), "No closed room")),

    /**
     * @param {Omit<Room, "version">} room
     * @returns {Promise<Readonly<Room>>}
     * @throws {ConflictError} when the code is already taken
     */
    async create(room) {
      try {
        return toRoom(await roomDao.insert(room));
      } catch (err) {
        if (err instanceof DuplicateKey) {
          throw new ConflictError("Room code already in use", { cause: err });
        }
        throw err;
      }
    },

    /**
     * Saves a changed room. `room.version` must be the version that was read, and `previous` the room as it was
     * read, so storage only writes what changed.
     *
     * @param {{ room: Room, previous: Readonly<Room> }} change
     * @returns {Promise<Readonly<Room>>}
     * @throws {ConcurrentChangeError} when the room changed in the meantime
     * @throws {NotFoundError} when the room no longer exists
     */
    save: async ({ room, previous }) =>
      toRoom(await orConcurrentChange(() => roomDao.update({ doc: room, previous }))),

    /**
     * Removes a room, as of the version that was read, and keeps a record of why.
     *
     * @param {{ room: Room, reason: string, closedAt: number }} closing
     * @throws {ConcurrentChangeError | NotFoundError}
     */
    close: ({ room, reason, closedAt }) =>
      orConcurrentChange(() =>
        roomDao.close({
          code: room.code,
          version: room.version,
          record: { code: room.code, gameId: room.gameId, reason, closedAt },
        }),
      ),

    /** @param {number} time  forgets records of rooms closed before this moment, and answers how many */
    forgetClosedBefore: (time) => roomDao.deleteClosedBefore(time),

    /** @returns {Promise<ReadonlyArray<Readonly<Room>>>} */
    listAll: async () => toRooms(await roomDao.list()),

    /** @param {string} playerId  the rooms where this player has a seat */
    listBySeat: async (playerId) => toRooms(await roomDao.listBySeat(playerId)),

    /** @param {number} now  the rooms whose game deadline has come */
    listDue: async (now) => toRooms(await roomDao.listDue(now)),

    /** @param {number} now  the rooms whose lifetime has ended */
    listExpired: async (now) => toRooms(await roomDao.listExpired(now)),
  });
}
