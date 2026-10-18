import { DuplicateKey } from "../persistence/errors.js";

/** Test double with the same contract as `createPlayerTransferDao` (verified by the shared contract tests). */
export function createInMemoryPlayerTransferDao() {
  const transfers = new Map();
  const copy = (doc) => structuredClone(doc);

  return Object.freeze({
    ensureIndexes: async () => {},

    async insertPending({ from, to, createdAt }) {
      if (transfers.has(from)) {
        throw new DuplicateKey(`Transfer from ${from} already exists`);
      }
      transfers.set(from, copy({ from, to, status: "pending", createdAt }));
      return copy(transfers.get(from));
    },

    async getByFrom(from) {
      if (!transfers.has(from)) {
        throw new RangeError(`No transfer from ${from}`);
      }
      return copy(transfers.get(from));
    },

    async markDone({ from, completedAt, carriedOver }) {
      const doc = transfers.get(from);
      if (doc?.status === "pending") {
        transfers.set(from, copy({ ...doc, status: "done", completedAt, carriedOver }));
      }
    },

    async listPending({ createdBefore, limit }) {
      return [...transfers.values()]
        .filter((doc) => doc.status === "pending" && doc.createdAt < createdBefore)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, limit)
        .map(copy);
    },

    async listByFrom(froms) {
      return froms.filter((from) => transfers.has(from)).map((from) => copy(transfers.get(from)));
    },

    async listByTo(accountPlayerId) {
      return [...transfers.values()]
        .filter((doc) => doc.to.id === accountPlayerId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(copy);
    },

    async deleteByTo(accountPlayerId) {
      const gone = [...transfers.values()].filter((doc) => doc.to.id === accountPlayerId);
      gone.forEach((doc) => transfers.delete(doc.from));
      return gone.length;
    },
  });
}
