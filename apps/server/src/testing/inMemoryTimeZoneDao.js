/**
 * A test double with the same contract as `createTimeZoneDao` (checked by the shared contract test). Documents are
 * copied in and out, like a real database.
 */
export function createInMemoryTimeZoneDao() {
  const docs = new Map();
  const copy = (value) => structuredClone(value);
  return Object.freeze({
    ensureIndexes: async () => {},
    findByPlayer: async (playerId) => (docs.has(playerId) ? [copy(docs.get(playerId))] : []),
    async save({ doc, expectedChangedAt }) {
      const stored = docs.get(doc.playerId);
      const matches =
        expectedChangedAt === null
          ? stored === undefined
          : stored !== undefined && stored.changedAt.getTime() === expectedChangedAt.getTime();
      if (!matches) {
        return false;
      }
      docs.set(doc.playerId, copy(doc));
      return true;
    },
    deleteByPlayer: async (playerId) => (docs.delete(playerId) ? 1 : 0),
  });
}
