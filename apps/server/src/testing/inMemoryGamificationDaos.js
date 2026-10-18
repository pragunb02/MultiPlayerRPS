/**
 * Test doubles with the same contracts as `createStatsDao`, `createQuestDao` and `createAchievementDao`
 * (verified by the shared contract tests). Documents are copied in and out, like a real database.
 */

const copy = (value) => structuredClone(value);

/** Compare-and-set store keyed by `keyOf(doc)`. */
function versionedStore(keyOf) {
  const docs = new Map();
  return {
    docs,
    find(key) {
      return docs.has(key) ? copy(docs.get(key)) : undefined;
    },
    save({ doc, expectedVersion }) {
      const key = keyOf(doc);
      const currentVersion = docs.get(key)?.version ?? 0;
      if (currentVersion !== expectedVersion) {
        return false;
      }
      docs.set(key, { ...copy(doc), version: expectedVersion + 1 });
      return true;
    },
  };
}

export function createInMemoryStatsDao() {
  const store = versionedStore((doc) => doc.playerId);
  return Object.freeze({
    ensureIndexes: async () => {},
    async findByPlayer(playerId) {
      const doc = store.find(playerId);
      if (doc === undefined) {
        throw new RangeError(`No stats for ${playerId}`);
      }
      return doc;
    },
    save: async (write) => store.save(write),
    async deleteByPlayer(playerId) {
      return store.docs.delete(playerId) ? 1 : 0;
    },
  });
}

export function createInMemoryQuestDao() {
  const keyOf = ({ playerId, day }) => `${playerId}\n${day}`;
  const store = versionedStore(keyOf);
  return Object.freeze({
    ensureIndexes: async () => {},
    async findDay({ playerId, day }) {
      const doc = store.find(keyOf({ playerId, day }));
      if (doc === undefined) {
        throw new RangeError(`No quests for ${playerId} on ${day}`);
      }
      return doc;
    },
    save: async (write) => store.save(write),
    async deleteByPlayer(playerId) {
      const keys = [...store.docs.values()].filter((doc) => doc.playerId === playerId).map(keyOf);
      keys.forEach((key) => store.docs.delete(key));
      return keys.length;
    },
    async listByPlayer(playerId) {
      return [...store.docs.values()]
        .filter((doc) => doc.playerId === playerId)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map(copy);
    },
  });
}

export function createInMemoryAchievementDao() {
  const unlocks = [];
  const order = (a, b) => a.unlockedAt - b.unlockedAt || (a.achievementId < b.achievementId ? -1 : 1);
  return Object.freeze({
    ensureIndexes: async () => {},
    async listByPlayer(playerId) {
      return unlocks
        .filter((u) => u.playerId === playerId)
        .sort(order)
        .map(copy);
    },
    async upsertEarliest({ playerId, achievementId, unlockedAt, matchId }) {
      const existing = unlocks.find((u) => u.playerId === playerId && u.achievementId === achievementId);
      if (existing === undefined) {
        unlocks.push({ playerId, achievementId, unlockedAt: new Date(unlockedAt), matchId });
        return { created: true };
      }
      if (unlockedAt < existing.unlockedAt) {
        existing.unlockedAt = new Date(unlockedAt);
      }
      return { created: false };
    },
    async deleteByPlayer(playerId) {
      let removed = 0;
      for (let i = unlocks.length - 1; i >= 0; i--) {
        if (unlocks[i].playerId === playerId) {
          unlocks.splice(i, 1);
          removed++;
        }
      }
      return removed;
    },
  });
}
