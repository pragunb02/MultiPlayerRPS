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

  /** Adds `inc` to an entry (creating it from zero) with the key lists in `keys`. */
  function add({ board, period, playerId, displayName, level, inc, at, expiresAt }, keys) {
    const ref = { board, period, playerId };
    const current = entries.get(keyOf(ref));
    write(ref, { displayName, level, score: (current?.score ?? 0) + inc, ...keys, updatedAt: at, expiresAt });
  }

  return Object.freeze({
    ensureIndexes: async () => {},

    async raiseScore({ board, period, playerId, displayName, level, score, at, expiresAt }) {
      const ref = { board, period, playerId };
      const current = entries.get(keyOf(ref));
      const raised = current === undefined || current.score < score;
      write(ref, raised ? { displayName, level, score, updatedAt: at, expiresAt } : { displayName, level });
      return { raised };
    },

    async addOnce({ key, ...write }) {
      const current = entries.get(keyOf(write));
      if (current?.recentKeys.includes(key) || current?.mergedKeys?.includes(key)) {
        return { applied: false };
      }
      add(write, { recentKeys: [...(current?.recentKeys ?? []), key].slice(-200) });
      return { applied: true };
    },

    async mergeOnce({ from, keys, ...write }) {
      const current = entries.get(keyOf(write));
      if (current?.mergedFrom?.includes(from)) {
        return { applied: false };
      }
      add(write, {
        mergedFrom: [...(current?.mergedFrom ?? []), from],
        mergedKeys: [...(current?.mergedKeys ?? []), ...keys].slice(-200),
      });
      return { applied: true };
    },

    async listWithKeys({ board, playerId }) {
      return [...entries.values()]
        .filter((entry) => entry.board === board && entry.playerId === playerId)
        .map(({ period, score, updatedAt, recentKeys, expiresAt }) => ({
          period,
          score,
          updatedAt: new Date(updatedAt),
          recentKeys: [...recentKeys],
          ...(expiresAt && { expiresAt: new Date(expiresAt) }),
        }));
    },

    async extendLifetime({ playerId, period, expiresAt }) {
      const rows = [...entries.values()].filter(
        (entry) => entry.playerId === playerId && entry.period === period && entry.expiresAt < expiresAt,
      );
      rows.forEach((entry) => write(entry, { expiresAt }));
      return rows.length;
    },

    async top({ board, period, limit, excluding = [] }) {
      return [...entries.values()]
        .filter(
          (entry) => entry.board === board && entry.period === period && !excluding.includes(entry.playerId),
        )
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

    async countAhead({ board, period, excluding = [], ...entry }) {
      return [...entries.values()].filter(
        (e) =>
          e.board === board && e.period === period && !excluding.includes(e.playerId) && ranksAbove(e, entry),
      ).length;
    },

    async listByPlayer(playerId) {
      return [...entries.values()]
        .filter((entry) => entry.playerId === playerId)
        .map((entry) => ({ board: entry.board, period: entry.period, ...publicFields(entry) }));
    },

    async renamePlayer({ playerId, displayName }) {
      const renamed = [...entries.entries()].filter(([, entry]) => entry.playerId === playerId);
      renamed.forEach(([key, entry]) => entries.set(key, { ...entry, displayName }));
      return renamed.length;
    },

    async deleteByPlayer(playerId) {
      const gone = [...entries.entries()].filter(([, entry]) => entry.playerId === playerId);
      gone.forEach(([key]) => entries.delete(key));
      return gone.length;
    },
  });
}
