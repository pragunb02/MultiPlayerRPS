/** Test double with the same contract as `createFeatureFlagDao` (verified by the shared contract tests). */
export function createInMemoryFeatureFlagDao() {
  /** @type {Map<string, object>} overrides by flag name */
  const overrides = new Map();
  /** @type {Map<string, object>} count rows by flag, day and side */
  const counts = new Map();
  const copy = (doc) => structuredClone(doc);

  return Object.freeze({
    ensureIndexes: async () => {},

    listOverrides: async () => [...overrides.values()].map(copy),

    async setOverride({ name, rollout, updatedAt }) {
      overrides.set(name, { name, rollout, updatedAt });
      return copy(overrides.get(name));
    },

    clearOverride: async (name) => (overrides.delete(name) ? 1 : 0),

    async addCounts(rows) {
      rows.forEach(({ flag, day, side, exposures, successes, expiresAt }) => {
        const key = JSON.stringify([flag, day, side]);
        const row = counts.get(key) ?? { flag, day, side, exposures: 0, successes: 0, expiresAt };
        counts.set(key, {
          ...row,
          exposures: row.exposures + exposures,
          successes: row.successes + successes,
        });
      });
    },

    async countsSince(fromDay) {
      const sums = new Map();
      [...counts.values()]
        .filter(({ day }) => day >= fromDay)
        .forEach(({ flag, side, exposures, successes }) => {
          const key = JSON.stringify([flag, side]);
          const sum = sums.get(key) ?? { flag, side, exposures: 0, successes: 0 };
          sums.set(key, {
            ...sum,
            exposures: sum.exposures + exposures,
            successes: sum.successes + successes,
          });
        });
      return [...sums.values()];
    },
  });
}
