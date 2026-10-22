import { DuplicateKey } from "../persistence/errors.js";

/** Test double with the same contract as `createSuspensionDao` (verified by the shared contract tests). */
export function createInMemorySuspensionDao() {
  /** @type {Map<string, object>} records by suspension id */
  const records = new Map();
  const copy = (doc) => structuredClone(doc);
  const newestFirst = (a, b) =>
    b.startedAt - a.startedAt ||
    (a.suspensionId < b.suspensionId ? 1 : a.suspensionId > b.suspensionId ? -1 : 0);
  const sorted = (test) => [...records.values()].filter(test).sort(newestFirst).map(copy);
  const inEffectAt = (doc, at) => doc.liftedAt === undefined && (doc.endsAt === null || doc.endsAt > at);

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert(doc) {
      if (records.has(doc.suspensionId)) throw new Error(`Duplicate suspension ${doc.suspensionId}`);
      if (
        doc.activeFor !== undefined &&
        [...records.values()].some((each) => each.activeFor === doc.activeFor)
      ) {
        throw new DuplicateKey(`${doc.activeFor} has a suspension in effect already`);
      }
      records.set(doc.suspensionId, copy({ endsAt: null, ...doc }));
      return copy(records.get(doc.suspensionId));
    },

    async getById(suspensionId) {
      const doc = records.get(suspensionId);
      if (doc === undefined) {
        throw new RangeError(`No suspension ${suspensionId}`);
      }
      return copy(doc);
    },

    listByPlayer: async (playerId) => sorted((doc) => doc.playerId === playerId),

    listActive: async ({ at }) => sorted((doc) => inEffectAt(doc, at)),

    async lift({ suspensionId, liftedAt, liftedById, liftedByName, deleteAt }) {
      const doc = records.get(suspensionId);
      if (doc === undefined || !inEffectAt(doc, liftedAt)) return false;
      const { activeFor, ...rest } = doc;
      records.set(suspensionId, { ...rest, liftedAt, liftedById, liftedByName, deleteAt });
      return true;
    },

    async releaseEnded({ playerId, at }) {
      const ended = [...records.values()].filter(
        (doc) => doc.activeFor === playerId && doc.endsAt !== null && doc.endsAt <= at,
      );
      ended.forEach(({ activeFor, ...rest }) => records.set(rest.suspensionId, rest));
      return ended.length;
    },

    async deleteByPlayer(playerId) {
      const ids = [...records.values()].filter((doc) => doc.playerId === playerId);
      ids.forEach((doc) => records.delete(doc.suspensionId));
      return ids.length;
    },
  });
}
