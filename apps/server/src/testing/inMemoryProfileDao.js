import { DuplicateKey } from "../persistence/errors.js";

/** Test double with the same contract as `createProfileDao` (verified by the shared contract tests). */
export function createInMemoryProfileDao() {
  /** @type {Map<string, object>} profiles by player id */
  const profiles = new Map();
  const copy = (doc) => structuredClone(doc);
  const byHandle = (handle) => [...profiles.values()].find((doc) => doc.handle === handle);

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert({ playerId, handle, createdAt }) {
      if (profiles.has(playerId) || byHandle(handle) !== undefined) {
        throw new DuplicateKey(`A profile for ${playerId} or the handle exists already`);
      }
      const doc = { playerId, handle, createdAt, updatedAt: createdAt };
      profiles.set(playerId, doc);
      return copy(doc);
    },

    findByPlayers: async (playerIds) =>
      [...new Set(playerIds)].filter((id) => profiles.has(id)).map((id) => copy(profiles.get(id))),

    async getByHandle(handle) {
      const doc = byHandle(handle);
      if (doc === undefined) {
        throw new RangeError("No profile has that handle");
      }
      return copy(doc);
    },

    async update({ playerId, set, updatedAt }) {
      const doc = profiles.get(playerId);
      if (doc === undefined) return 0;
      profiles.set(playerId, { ...doc, ...structuredClone(set), updatedAt });
      return 1;
    },

    async rename({ from, to }) {
      const doc = profiles.get(from);
      if (doc === undefined) return 0;
      if (profiles.has(to)) {
        throw new DuplicateKey(`${to} has a profile already`);
      }
      profiles.delete(from);
      profiles.set(to, { ...doc, playerId: to });
      return 1;
    },

    async deleteByPlayer(playerId) {
      return profiles.delete(playerId) ? 1 : 0;
    },
  });
}
