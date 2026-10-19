import { DuplicateKey } from "../persistence/errors.js";

/** Test double with the same contract as `createBlockDao` (verified by the shared contract tests). */
export function createInMemoryBlockDao() {
  /** @type {Map<string, object>} records by block id */
  const blocks = new Map();
  const copy = (doc) => structuredClone(doc);
  const newestFirst = (a, b) => b.createdAt - a.createdAt;
  const find = (test) => [...blocks.values()].filter(test);
  const pairOf = (blockerId, blockedId) =>
    find((doc) => doc.blockerId === blockerId && doc.blockedId === blockedId)[0];

  function move(field, other, { from, to }) {
    let moved = 0;
    for (const doc of find((each) => each[field] === from)) {
      const next = { ...doc, [field]: to };
      if (doc[other] === to || pairOf(next.blockerId, next.blockedId) !== undefined) {
        blocks.delete(doc.blockId);
        continue;
      }
      blocks.set(doc.blockId, next);
      moved += 1;
    }
    return moved;
  }

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert(block) {
      if (pairOf(block.blockerId, block.blockedId) !== undefined || blocks.has(block.blockId)) {
        throw new DuplicateKey(`${block.blockerId} already blocked ${block.blockedId}`);
      }
      blocks.set(block.blockId, copy(block));
      return copy(block);
    },

    async getByPair({ blockerId, blockedId }) {
      const doc = pairOf(blockerId, blockedId);
      if (doc === undefined) {
        throw new RangeError(`${blockerId} has not blocked ${blockedId}`);
      }
      return copy(doc);
    },

    listByBlocker: async (blockerId) =>
      find((doc) => doc.blockerId === blockerId)
        .sort(newestFirst)
        .map(copy),

    listInvolving: async (playerId) =>
      find((doc) => doc.blockerId === playerId || doc.blockedId === playerId).map(copy),

    async deleteOwn({ blockerId, blockId }) {
      if (blocks.get(blockId)?.blockerId !== blockerId) return 0;
      blocks.delete(blockId);
      return 1;
    },

    async keepNewest({ blockerId, keep }) {
      const older = find((doc) => doc.blockerId === blockerId)
        .sort(newestFirst)
        .slice(keep);
      older.forEach((doc) => blocks.delete(doc.blockId));
      return older.length;
    },

    moveBlocker: async (transfer) => move("blockerId", "blockedId", transfer),
    moveBlocked: async (transfer) => move("blockedId", "blockerId", transfer),

    async deleteInvolving(playerId) {
      const gone = find((doc) => doc.blockerId === playerId || doc.blockedId === playerId);
      gone.forEach((doc) => blocks.delete(doc.blockId));
      return gone.length;
    },
  });
}
