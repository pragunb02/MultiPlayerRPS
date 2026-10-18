/** Test double with the same contract as `createAccountDeletionDao` (verified by the shared contract tests). */
export function createInMemoryAccountDeletionDao() {
  const deletions = new Map();
  const closedLegacy = new Set();

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert({ playerId, requestedAt, sweepAgainAt, expiresAt }) {
      if (!deletions.has(playerId)) {
        deletions.set(playerId, { playerId, requestedAt, sweepAgainAt, expiresAt });
      }
    },

    async listDue({ now, limit }) {
      return [...deletions.values()]
        .filter((entry) => entry.sweepAgainAt !== undefined && entry.sweepAgainAt <= now)
        .sort((a, b) => a.sweepAgainAt - b.sweepAgainAt)
        .slice(0, limit)
        .map(({ playerId, requestedAt }) => ({ playerId, requestedAt }));
    },

    async markSwept(playerId) {
      const entry = deletions.get(playerId);
      if (entry !== undefined) {
        const { sweepAgainAt, ...rest } = entry;
        deletions.set(playerId, rest);
      }
    },

    async closeLegacy({ legacyId }) {
      closedLegacy.add(legacyId);
    },

    isLegacyClosed: async (legacyId) => closedLegacy.has(legacyId),
  });
}
