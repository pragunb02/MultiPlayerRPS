import { DuplicateKey } from "../persistence/errors.js";

/** Test double with the same contract as `createProgressDao` (verified by the shared contract tests). */
export function createInMemoryProgressDao() {
  const COUNTERS = ["xp", "unrankedXp", "matchesPlayed", "wins", "losses", "draws"];
  const players = new Map();
  const totalsOf = (doc) => Object.fromEntries(COUNTERS.map((key) => [key, doc?.[key] ?? 0]));
  const add = (totals, inc) =>
    Object.fromEntries(COUNTERS.map((key) => [key, totals[key] + (inc[key] ?? 0)]));

  return Object.freeze({
    ensureIndexes: async () => {},

    async applyMatchOnce({ playerId, matchId, inc, at }) {
      const current = players.get(playerId);
      if (current?.mergedInto !== undefined) {
        return { applied: false, before: totalsOf(current), mergedInto: current.mergedInto };
      }
      if (current?.recentMatchIds.includes(matchId)) {
        return { applied: false, before: totalsOf(current) };
      }
      const before = totalsOf(current);
      players.set(playerId, {
        ...current,
        ...add(before, inc),
        recentMatchIds: [...(current?.recentMatchIds ?? []), matchId].slice(-200),
        updatedAt: new Date(at),
      });
      return { applied: true, before };
    },

    async markMergedInto({ from, to, at }) {
      const current = players.get(from) ?? { ...totalsOf(undefined), recentMatchIds: [], updatedAt: at };
      if (current.mergedInto !== undefined && current.mergedInto !== to) {
        throw new DuplicateKey(`Progress of ${from} already moved to another player`);
      }
      players.set(from, { ...current, mergedInto: to });
      return { totals: totalsOf(current), recentMatchIds: [...current.recentMatchIds] };
    },

    async addMerged({ to, from, totals, recentMatchIds, at }) {
      const current = players.get(to);
      if (current?.mergedFrom?.includes(from)) {
        return { applied: false };
      }
      players.set(to, {
        ...current,
        ...add(totalsOf(current), totals),
        recentMatchIds: [...(current?.recentMatchIds ?? []), ...recentMatchIds].slice(-200),
        mergedFrom: [...(current?.mergedFrom ?? []), from],
        updatedAt: new Date(at),
      });
      return { applied: true };
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
