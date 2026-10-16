import { DuplicateKey, VersionConflict } from "../persistence/errors.js";

/**
 * Test double with the same contract as `createRoomDao` (verified by the shared room DAO contract tests), so
 * domain and service tests run without MongoDB. Every read and write is a deep copy, so callers can never
 * change stored state by accident.
 */
export function createInMemoryRoomDao() {
  /** @type {Map<string, object>} */
  const rooms = new Map();
  /** @type {Map<string, object>} */
  const closed = new Map();
  const copy = (doc) => structuredClone(doc);
  const where = (keep) => [...rooms.values()].filter(keep).map(copy);

  function current(code) {
    const doc = rooms.get(code);
    if (doc === undefined) {
      throw new RangeError(`No room ${code}`);
    }
    return doc;
  }

  function checkVersion(code, version) {
    const doc = current(code);
    if (doc.version !== version) {
      throw new VersionConflict(`Room ${code} is at version ${doc.version}, not ${version}`);
    }
  }

  return Object.freeze({
    ensureIndexes: async () => {},

    has: async (code) => rooms.has(code),

    get: async (code) => copy(current(code)),

    async insert(doc) {
      if (rooms.has(doc.code)) {
        throw new DuplicateKey(`Room ${doc.code} already exists`);
      }
      rooms.set(doc.code, copy({ ...doc, version: 1 }));
      return copy(rooms.get(doc.code));
    },

    async update(doc) {
      checkVersion(doc.code, doc.version);
      rooms.set(doc.code, copy({ ...doc, version: doc.version + 1 }));
      return copy(rooms.get(doc.code));
    },

    async close({ code, version, record }) {
      checkVersion(code, version);
      rooms.delete(code);
      closed.set(code, copy(record));
    },

    hasClosed: async (code) => closed.has(code),

    async getClosed(code) {
      if (!closed.has(code)) {
        throw new RangeError(`No closed room ${code}`);
      }
      return copy(closed.get(code));
    },

    async deleteClosedBefore(time) {
      const old = [...closed.values()].filter((record) => record.closedAt < time);
      old.forEach((record) => closed.delete(record.code));
      return old.length;
    },

    list: async () => where(() => true),

    listBySeat: async (playerId) => where((doc) => doc.seats.some((seat) => seat.playerId === playerId)),

    listDue: async (now) => where((doc) => doc.dueAt > 0 && doc.dueAt <= now),

    listExpired: async (now) => where((doc) => doc.expiresAt <= now),
  });
}
