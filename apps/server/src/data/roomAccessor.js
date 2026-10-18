import { ROOM_STATUS } from "@classicade/shared";
import { ConcurrentChangeError, ConflictError, NotFoundError } from "../utils/errors.js";
import { assertDefined } from "../utils/assert.js";
import { DuplicateKey, VersionConflict } from "../persistence/errors.js";

/**
 * @typedef {Object} Seat
 * @property {string} playerId
 * @property {string} displayName
 * @property {boolean} connected        the room page is open (CC-158)
 * @property {boolean} [away]          on another page of the site (CC-207). Older seats leave it out
 * @property {number} [since]          when the presence last changed. Older seats leave it out
 *
 * @typedef {{ kind: "move", playerId: string, move: unknown, at: number }
 *   | { kind: "forfeit", playerId: string, at: number }
 *   | { kind: "expire", at: number }
 *   | { kind: "agree", type: string, from: string, playerId: string, at: number }
 *   | { kind: "idle", playerIds: string[], at: number }} LogEntry   every state change, in order, with server
 *   time. `agree` is a request of the game accepted by `playerId` (CC-159), `idle` the players who did not move in
 *   time (CC-036)
 *
 * @typedef {Object} RoomRequest       something one player asked the other (CC-159, see roomRequests.js)
 * @property {string} type
 * @property {string} from
 * @property {string} to
 * @property {number} createdAt
 * @property {number} expiresAt
 * @property {string} state            a REQUEST_STATES value
 * @property {number} endedAt          0 while open
 *
 * @typedef {Object} Room              a domain model: deeply frozen, changed only by producing a new room
 * @property {string} code
 * @property {string} gameId
 * @property {Readonly<Record<string, unknown>>} options
 * @property {"waiting" | "playing" | "finished"} status
 * @property {string} hostId
 * @property {string} [network]        an opaque name of the network the room was opened from, for the cap per network
 * @property {ReadonlyArray<Readonly<Seat>>} seats
 * @property {{ matchId: string, number?: number, seed: number, startedAt: number, state: unknown, log: ReadonlyArray<LogEntry>, asked?: Record<string, Record<string, number>>, resumedAt?: number, turnCredit?: { entries: number, ms: number } }} [game]
 *   present once the game has started. Its `seed` and `log` reproduce the game exactly (see replayGame). `number`
 *   counts the room's games from 1, and `asked` how often each player asked each limited request in this game.
 *   `resumedAt` is when the game last resumed after a server restart, and `turnCredit` the time given back to the
 *   current turn (the one after `entries` log entries) for a player due who was offline (see roomPresence.js)
 * @property {ReadonlyArray<Readonly<RoomRequest>>} [requests]  open requests, and ended ones for a few seconds
 * @property {Readonly<{ status: string, result: string, winners: string[], reason: string }>} [result]  final outcome once finished (played out or forfeited)
 * @property {number} [finishedAt]      when the last game ended, the rematch window counts from here (CC-101)
 * @property {Readonly<{ available: boolean, leftName?: string }>} [rematch]
 *   once finished: whether playing again is still possible (CC-037), and the name of a player who left the
 *   finished game (CC-162). Who asked is a request (CC-159). Rooms stored before that may still carry the old
 *   `requestedBy` and `declinedBy`, which nothing reads
 * @property {Readonly<{ games: number, wins: Readonly<Record<string, number>> }>} [series]  games finished in this room
 *   and wins per player, across rematches
 * @property {number} createdAt
 * @property {number} lastActivityAt
 * @property {number} dueAt              when something next happens in the room by itself (a chess flag, an idle
 *   limit, a request expiring, a seat given up), 0 for none (kept so the every second check asks storage for due
 *   rooms only)
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

    /** @returns {Promise<number>} how many rooms are open, cheap enough to ask before every new room (CC-107) */
    countOpen: () => roomDao.countOpen(),

    /**
     * @param {ReadonlyArray<string>} networks  how many open rooms were opened under any of these names of one
     *   network (CC-107, CC-249)
     */
    countByNetworks: (networks) => roomDao.countByNetworks(networks),

    /** @returns {Promise<Readonly<Record<"waiting" | "playing" | "finished", number>>>} open rooms per status */
    async countByStatus() {
      const counts = await roomDao.countByStatus();
      return Object.freeze(
        Object.fromEntries(Object.values(ROOM_STATUS).map((status) => [status, counts[status] ?? 0])),
      );
    },
  });
}
