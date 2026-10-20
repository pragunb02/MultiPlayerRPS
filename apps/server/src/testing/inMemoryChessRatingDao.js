import { CHESS_RATING_START } from "@classicade/shared";
import { DuplicateKey, VersionConflict } from "../persistence/errors.js";

/** Test double with the same contract as `createChessRatingDao` (verified by the shared contract tests). */
export function createInMemoryChessRatingDao() {
  const players = new Map();
  const copy = (doc) => structuredClone(doc);

  return Object.freeze({
    ensureIndexes: async () => {},

    async getByPlayer(playerId) {
      const doc = players.get(playerId);
      if (doc === undefined) {
        throw new RangeError(`No chess rating for ${playerId}`);
      }
      return copy(doc);
    },

    async write({ playerId, revision, doc }) {
      const current = players.get(playerId);
      const stale =
        revision === 0
          ? current !== undefined
          : current?.revision !== revision || current.mergedInto !== undefined;
      if (stale) {
        throw new VersionConflict(`The chess rating of ${playerId} changed since revision ${revision}`);
      }
      players.set(playerId, copy({ ...doc, playerId, revision: revision + 1 }));
    },

    async markMergedInto({ from, to, at }) {
      const current = players.get(from);
      if (current?.mergedInto !== undefined) {
        if (current.mergedInto !== to) {
          throw new DuplicateKey(`The chess rating of ${from} moved to another player`);
        }
        return copy(current);
      }
      const base = current ?? {
        playerId: from,
        ...CHESS_RATING_START,
        games: 0,
        changes: [],
        mergedFrom: [],
        revision: 0,
      };
      const marked = { ...base, mergedInto: to, updatedAt: at, revision: base.revision + 1 };
      players.set(from, copy(marked));
      return copy(marked);
    },

    async deleteByPlayer(playerId) {
      const gone = [...players.values()].filter(
        (doc) => doc.playerId === playerId || doc.mergedInto === playerId,
      );
      gone.forEach((doc) => players.delete(doc.playerId));
      return gone.length;
    },
  });
}
