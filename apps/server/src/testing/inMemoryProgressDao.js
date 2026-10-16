/** Test double with the same contract as `createProgressDao` (verified by the shared contract tests). */
export function createInMemoryProgressDao() {
  const COUNTERS = ["xp", "matchesPlayed", "wins", "losses", "draws"];
  const players = new Map();
  const totalsOf = (doc) => Object.fromEntries(COUNTERS.map((key) => [key, doc?.[key] ?? 0]));

  return Object.freeze({
    ensureIndexes: async () => {},

    async applyMatchOnce({ playerId, matchId, inc, at }) {
      const current = players.get(playerId);
      if (current?.recentMatchIds.includes(matchId)) {
        return { applied: false, before: totalsOf(current) };
      }
      const before = totalsOf(current);
      const next = Object.fromEntries(COUNTERS.map((key) => [key, before[key] + (inc[key] ?? 0)]));
      players.set(playerId, {
        ...next,
        recentMatchIds: [...(current?.recentMatchIds ?? []), matchId].slice(-200),
        updatedAt: new Date(at),
      });
      return { applied: true, before };
    },

    async getByPlayer(playerId) {
      const doc = players.get(playerId);
      if (doc === undefined) {
        throw new RangeError(`No progress for ${playerId}`);
      }
      return { playerId, ...totalsOf(doc), updatedAt: new Date(doc.updatedAt) };
    },
  });
}
