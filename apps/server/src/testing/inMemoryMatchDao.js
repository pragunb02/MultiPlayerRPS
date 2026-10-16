import { DuplicateKey } from "../persistence/errors.js";

/**
 * Test double with the same contract as `createMatchDao` (verified by the shared DAO contract tests),
 * so service/domain tests can run without MongoDB.
 */
export function createInMemoryMatchDao() {
  const matches = new Map();
  const copy = (doc) => structuredClone(doc);

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert(doc) {
      if (matches.has(doc.matchId)) {
        throw new DuplicateKey(`Match ${doc.matchId} already recorded`);
      }
      matches.set(doc.matchId, copy({ ...doc, schemaVersion: 1 }));
      return copy(matches.get(doc.matchId));
    },

    async getByMatchId(matchId) {
      if (!matches.has(matchId)) {
        throw new RangeError(`No match ${matchId}`);
      }
      return copy(matches.get(matchId));
    },

    async listByPlayer(playerId, { limit, before }) {
      return [...matches.values()]
        .filter((m) => m.players.some((p) => p.playerId === playerId))
        .filter((m) => before === undefined || m.endedAt < before)
        .sort((a, b) => b.endedAt - a.endedAt)
        .slice(0, limit)
        .map(copy);
    },
  });
}
