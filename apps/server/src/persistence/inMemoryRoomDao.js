/**
 * Room storage for a single server instance. Rooms are short-lived and live in memory; the DAO contract
 * (copies in and out, optimistic versioning) is what a Redis-backed DAO will implement for multi-instance
 * scaling (CC-061) without changes above this layer.
 *
 * Persistence objects are plain JSON; every read and write is a deep copy, so callers can never mutate
 * stored state by accident.
 */
export class VersionConflict extends Error {}
export class DuplicateKey extends Error {}

export function createInMemoryRoomDao() {
  /** @type {Map<string, object>} */
  const rooms = new Map();

  return Object.freeze({
    /** @param {string} code */
    has: (code) => rooms.has(code),

    /**
     * @param {string} code
     * @returns {object} a copy of the stored document
     * @throws {RangeError} when absent — callers check `has` or translate the error
     */
    get(code) {
      const doc = rooms.get(code);
      if (doc === undefined) {
        throw new RangeError(`No room ${code}`);
      }
      return structuredClone(doc);
    },

    /**
     * @param {{ code: string }} doc  stored with version 1
     * @returns {object} the stored copy
     */
    insert(doc) {
      if (rooms.has(doc.code)) {
        throw new DuplicateKey(`Room ${doc.code} already exists`);
      }
      const stored = structuredClone({ ...doc, version: 1 });
      rooms.set(doc.code, stored);
      return structuredClone(stored);
    },

    /**
     * Replaces a document only if nobody else changed it since it was read.
     *
     * @param {{ code: string, version: number }} doc
     * @returns {object} the stored copy with its version incremented
     */
    update(doc) {
      const current = rooms.get(doc.code);
      if (current === undefined) {
        throw new RangeError(`No room ${doc.code}`);
      }
      if (current.version !== doc.version) {
        throw new VersionConflict(`Room ${doc.code} is at version ${current.version}, not ${doc.version}`);
      }
      const stored = structuredClone({ ...doc, version: doc.version + 1 });
      rooms.set(doc.code, stored);
      return structuredClone(stored);
    },

    /** @param {string} code */
    delete: (code) => rooms.delete(code),

    /** @returns {object[]} copies of every stored room */
    list: () => [...rooms.values()].map((doc) => structuredClone(doc)),
  });
}
