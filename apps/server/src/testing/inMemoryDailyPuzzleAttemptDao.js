import { DuplicateKey, VersionConflict } from "../persistence/errors.js";

const FINISHED = new Set(["solved", "failed"]);
const keyOf = ({ playerId, kind, day }) => `${playerId}|${kind}|${day}`;
const copy = (doc) => structuredClone(doc);

/**
 * An in-memory stand-in for `createDailyPuzzleAttemptDao`, with the same contract (testing/dailyPuzzleAttemptDaoContract.js).
 * `failNextUpdate` makes the next change meet a conflict, as two tabs moving at once would.
 */
export function createInMemoryDailyPuzzleAttemptDao() {
  const docs = new Map();
  let conflictPending = false;

  const ofPlayer = (playerId) => [...docs.values()].filter((doc) => doc.playerId === playerId);

  return Object.freeze({
    ensureIndexes: async () => {},

    failNextUpdate() {
      conflictPending = true;
    },

    async insert(attempt) {
      if (docs.has(keyOf(attempt))) {
        throw new DuplicateKey(
          `${attempt.playerId} already has the ${attempt.kind} puzzle of ${attempt.day}`,
        );
      }
      docs.set(keyOf(attempt), copy(attempt));
    },

    findDay: async (key) => (docs.has(keyOf(key)) ? [copy(docs.get(keyOf(key)))] : []),

    async findLatestFinished({ playerId, kind, beforeDay }) {
      const latest = ofPlayer(playerId)
        .filter((doc) => doc.kind === kind && doc.day < beforeDay && FINISHED.has(doc.status))
        .sort((a, b) => b.day.localeCompare(a.day))
        .slice(0, 1);
      return latest.map(copy);
    },

    async update({ playerId, kind, day, version }, changes) {
      const doc = docs.get(keyOf({ playerId, kind, day }));
      if (conflictPending || doc === undefined || doc.version !== version) {
        conflictPending = false;
        throw new VersionConflict(`The ${kind} puzzle of ${day} for ${playerId} changed or is gone`);
      }
      const updated = { ...doc, ...copy(changes), version: version + 1 };
      docs.set(keyOf(updated), updated);
      return copy(updated);
    },

    listByPlayer: async (playerId) =>
      ofPlayer(playerId)
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.day.localeCompare(b.day))
        .map(copy),

    async reassign({ from, to, kind, day }) {
      const doc = docs.get(keyOf({ playerId: from, kind, day }));
      if (doc === undefined) return 0;
      docs.delete(keyOf(doc));
      docs.set(keyOf({ playerId: to, kind, day }), { ...doc, playerId: to });
      return 1;
    },

    deleteDay: async (key) => (docs.delete(keyOf(key)) ? 1 : 0),

    async deleteByPlayer(playerId) {
      const mine = ofPlayer(playerId);
      mine.forEach((doc) => docs.delete(keyOf(doc)));
      return mine.length;
    },
  });
}
