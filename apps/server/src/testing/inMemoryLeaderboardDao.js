/** Test double with the same contract as `createLeaderboardDao` (verified by the shared contract tests). */
export function createInMemoryLeaderboardDao() {
  const entries = new Map();
  const keyOf = ({ board, period, playerId }) => JSON.stringify([board, period, playerId]);
  const publicFields = ({ playerId, displayName, level, score, updatedAt }) => ({
    playerId,
    displayName,
    level,
    score,
    updatedAt: new Date(updatedAt),
  });
  const ranksAbove = (a, b) =>
    a.score > b.score ||
    (a.score === b.score &&
      (a.updatedAt < b.updatedAt || (+a.updatedAt === +b.updatedAt && a.playerId < b.playerId)));
  const write = (ref, { expiresAt, ...changes }) =>
    entries.set(keyOf(ref), {
      score: 0,
      recentKeys: [],
      ...entries.get(keyOf(ref)),
      ...ref,
      ...changes,
      ...(expiresAt && { expiresAt }),
    });

  return Object.freeze({
    ensureIndexes: async () => {},

    async raiseScore({ board, period, playerId, displayName, level, score, at, expiresAt }) {
      const ref = { board, period, playerId };
      const current = entries.get(keyOf(ref));
      const raised = current === undefined || current.score < score;
      write(ref, raised ? { displayName, level, score, updatedAt: at, expiresAt } : { displayName, level });
      return { raised };
    },

    async addOnce({ board, period, playerId, displayName, level, key, inc, at, expiresAt }) {
      const ref = { board, period, playerId };
      const current = entries.get(keyOf(ref));
      if (current?.recentKeys.includes(key)) {
        return { applied: false };
      }
      write(ref, {
        displayName,
        level,
        score: (current?.score ?? 0) + inc,
        recentKeys: [...(current?.recentKeys ?? []), key].slice(-200),
        updatedAt: at,
        expiresAt,
      });
      return { applied: true };
    },

    async top({ board, period, limit }) {
      return [...entries.values()]
        .filter((entry) => entry.board === board && entry.period === period)
        .sort((a, b) => (ranksAbove(a, b) ? -1 : 1))
        .slice(0, limit)
        .map(publicFields);
    },

    async getEntry(ref) {
      const entry = entries.get(keyOf(ref));
      if (entry === undefined) {
        throw new RangeError(`No ${ref.board} ${ref.period} entry for ${ref.playerId}`);
      }
      return publicFields(entry);
    },

    async countAhead({ board, period, ...entry }) {
      return [...entries.values()].filter(
        (e) => e.board === board && e.period === period && ranksAbove(e, entry),
      ).length;
    },
  });
}
