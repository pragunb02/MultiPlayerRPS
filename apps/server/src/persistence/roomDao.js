import { DuplicateKey, VersionConflict } from "./errors.js";
import { roomChanges } from "./roomChanges.js";

const DUPLICATE_KEY_CODE = 11000;
const ROOMS = "rooms";
const CLOSED_ROOMS = "closed_rooms";
const WITHOUT_ID = Object.freeze({ projection: { _id: 0 } });
// While a room is being closed its document carries the closed record in `closing` (see `close`).
const OPEN = Object.freeze({ closing: { $exists: false } });
const CLOSING = Object.freeze({ closing: { $exists: true } });

/**
 * @typedef {Object} RoomDoc               persistence object: plain JSON, times as epoch milliseconds
 * @property {string} code
 * @property {string} gameId
 * @property {Record<string, unknown>} options
 * @property {string} status
 * @property {string} hostId
 * @property {string} [network]        an opaque name of the network the room was opened from (rooms before CC-107 have none)
 * @property {Array<{ playerId: string, displayName: string, connected: boolean }>} seats
 * @property {Record<string, unknown>} [game]
 * @property {Record<string, unknown>} [result]
 * @property {Record<string, unknown>} [rematch]
 * @property {Record<string, unknown>} [series]
 * @property {number} createdAt
 * @property {number} lastActivityAt
 * @property {number} dueAt              when the running game's next deadline falls (0 = none)
 * @property {number} expiresAt          when the room's lifetime ends
 * @property {number} version            optimistic concurrency token, counted up on every write
 *
 * @typedef {{ code: string, gameId: string, reason: string, closedAt: number }} ClosedRoomDoc
 */

/**
 * Rooms in MongoDB (CC-101), so a deploy, a crash or the hosting plan's sleep never loses a game. Every write
 * names the version it read. A write from an older version fails instead of overwriting someone else's change.
 * Closing a room leaves a small record of why, kept until `deleteClosedBefore` forgets it. At no moment is a
 * closing room missing both as a room and as a record, so a player who asks at that very moment hears why it
 * closed instead of being told it never existed.
 *
 * Rooms are stored as they are (nested game state included) through the driver directly: game states are
 * engine owned JSON, so a schema here would only get in the way.
 *
 * @param {{ connection: import("mongoose").Connection, betweenClosedReads?: () => Promise<void> }} deps
 *   `betweenClosedReads` runs between the two reads that look for a closed room. Tests close a room there.
 */
export function createRoomDao({ connection, betweenClosedReads = async () => {} }) {
  // Fields that are undefined are left out, as JSON would, so a stored room reads back like the one written.
  const rooms = connection.db.collection(ROOMS, { ignoreUndefined: true });
  const closed = connection.db.collection(CLOSED_ROOMS, { ignoreUndefined: true });

  /** A write that matched nothing: either somebody else changed the room first, or it is not there at all. */
  async function missed(code, version) {
    if ((await rooms.countDocuments({ code, ...OPEN }, { limit: 1 })) === 0) {
      throw new RangeError(`No room ${code}`);
    }
    throw new VersionConflict(`Room ${code} is no longer at version ${version}`);
  }

  const find = (filter) => rooms.find({ ...filter, ...OPEN }, WITHOUT_ID).toArray();

  /**
   * Why a room closed, or null when it did not. The room being closed is read before the record. A close writes
   * the record before it deletes the room, so a close that finishes between the two reads is found by the second
   * one. Reading the record first missed such a close and told the player the room never existed (CC-204).
   *
   * @param {string} code
   * @returns {Promise<ClosedRoomDoc | null>}
   */
  async function closedRecordOf(code) {
    const closing = await rooms.findOne({ code, ...CLOSING }, { projection: { _id: 0, closing: 1 } });
    if (closing !== null) {
      return closing.closing;
    }
    await betweenClosedReads();
    return closed.findOne({ code }, WITHOUT_ID);
  }

  /**
   * @param {string} code
   * @returns {Promise<RoomDoc>}
   * @throws {RangeError} when absent
   */
  async function get(code) {
    const doc = await rooms.findOne({ code, ...OPEN }, WITHOUT_ID);
    if (doc === null) {
      throw new RangeError(`No room ${code}`);
    }
    return doc;
  }

  return Object.freeze({
    /** Creates the collections' indexes. Awaited at boot, so the regular queries never read every room. */
    async ensureIndexes() {
      await rooms.createIndexes([
        { key: { code: 1 }, unique: true, name: "code_unique" },
        // Rooms a player sits in: signing in or out changes their seats.
        { key: { "seats.playerId": 1 }, name: "seats_player" },
        // Every second: rooms whose game deadline has come (a chess flag).
        { key: { dueAt: 1 }, name: "due_at" },
        // Every minute: rooms whose lifetime has ended.
        { key: { expiresAt: 1 }, name: "expires_at" },
        // Before every new room: how many rooms its host's network already has open (CC-107).
        { key: { network: 1 }, name: "network" },
      ]);
      await closed.createIndexes([
        { key: { code: 1 }, unique: true, name: "code_unique" },
        { key: { closedAt: 1 }, name: "closed_at" },
      ]);
    },

    /** @param {string} code */
    has: async (code) => (await rooms.countDocuments({ code, ...OPEN }, { limit: 1 })) === 1,

    get,

    /**
     * @param {Omit<RoomDoc, "version">} doc   stored with version 1
     * @returns {Promise<RoomDoc>}
     * @throws {DuplicateKey} when the code is taken
     */
    async insert(doc) {
      try {
        // The driver adds an _id to what it is given, so it gets a copy.
        await rooms.insertOne({ ...structuredClone(doc), version: 1 });
      } catch (err) {
        if (err.code === DUPLICATE_KEY_CODE) {
          throw new DuplicateKey(`Room ${doc.code} already exists`, { cause: err });
        }
        throw err;
      }
      return get(doc.code);
    },

    /**
     * Changes a room only if nobody changed it since it was read. Only the fields that differ from `previous`
     * are written, and the stored room comes back in the same round trip (CC-182). That is safe because the
     * write only matches the version that was read, and that version is exactly `previous`.
     *
     * @param {{ doc: RoomDoc, previous: RoomDoc }} change   `doc.version` is the version that was read, and
     *   `previous` is the room as it was read at that version
     * @returns {Promise<RoomDoc>} the stored room, its version counted up
     * @throws {VersionConflict | RangeError}
     */
    async update({ doc, previous }) {
      const { version, ...next } = doc;
      const { version: _, ...before } = previous;
      const stored = await rooms.findOneAndUpdate(
        { code: doc.code, version, ...OPEN },
        { ...roomChanges(before, next), $inc: { version: 1 } },
        { ...WITHOUT_ID, returnDocument: "after" },
      );
      if (stored === null) {
        await missed(doc.code, version);
      }
      return stored;
    },

    /**
     * Removes a room (only from the version that was read) and keeps a record of why it closed. Three steps,
     * because MongoDB cannot change two collections at once here. First the room itself is marked as closing,
     * which only succeeds from the version that was read. From then on it reads as closed. Then the record is
     * written, then the room is deleted. A process that stops between the steps leaves a room marked as
     * closing, which still reads as closed and is forgotten like any record.
     *
     * @param {{ code: string, version: number, record: ClosedRoomDoc }} closing
     * @throws {VersionConflict | RangeError}
     */
    async close({ code, version, record }) {
      const { matchedCount } = await rooms.updateOne(
        { code, version, ...OPEN },
        { $set: { closing: { ...record } }, $inc: { version: 1 } },
      );
      if (matchedCount === 0) {
        await missed(code, version);
      }
      await closed.replaceOne({ code }, { ...record }, { upsert: true });
      await rooms.deleteOne({ code, ...CLOSING });
    },

    /** @param {string} code */
    hasClosed: async (code) => (await closedRecordOf(code)) !== null,

    /**
     * @param {string} code
     * @returns {Promise<ClosedRoomDoc>}
     * @throws {RangeError} when there is no record
     */
    async getClosed(code) {
      const record = await closedRecordOf(code);
      if (record === null) {
        throw new RangeError(`No closed room ${code}`);
      }
      return record;
    },

    /**
     * @param {number} time  records closed before this moment are forgotten
     * @returns {Promise<number>} how many
     */
    async deleteClosedBefore(time) {
      const records = await closed.deleteMany({ closedAt: { $lt: time } });
      const leftovers = await rooms.deleteMany({ ...CLOSING, "closing.closedAt": { $lt: time } });
      return records.deletedCount + leftovers.deletedCount;
    },

    /** @returns {Promise<RoomDoc[]>} */
    list: () => find({}),

    /** @param {string} playerId */
    listBySeat: (playerId) => find({ "seats.playerId": playerId }),

    /** @param {number} now  rooms with a game deadline at or before `now` */
    listDue: (now) => find({ dueAt: { $gt: 0, $lte: now } }),

    /** @param {number} now  rooms whose lifetime ended at or before `now` */
    listExpired: (now) => find({ expiresAt: { $lte: now } }),

    /**
     * How many rooms are stored, read from the collection's own count, so it costs the same however many rooms
     * there are. A room left half closed by a stopped process is still counted until it is forgotten, which only
     * makes the count a little high for a day.
     *
     * @returns {Promise<number>}
     */
    countOpen: () => rooms.estimatedDocumentCount(),

    /** @param {string} network  open rooms opened from this network */
    countByNetwork: (network) => rooms.countDocuments({ network, ...OPEN }),

    /** @returns {Promise<Record<string, number>>} open rooms per status, only for statuses that have any */
    async countByStatus() {
      const groups = await rooms
        .aggregate([{ $match: { ...OPEN } }, { $group: { _id: "$status", rooms: { $sum: 1 } } }])
        .toArray();
      return Object.fromEntries(groups.map((group) => [group._id, group.rooms]));
    },
  });
}
