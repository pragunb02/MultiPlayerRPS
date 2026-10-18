/** Test double with the same contract as `createPendingMatchDao` (verified by the shared contract tests). */
export function createInMemoryPendingMatchDao() {
  const records = new Map();
  const copy = (doc) => structuredClone(doc);
  /** Changes a record that is there and passes `when`, as a filtered update does. */
  const change = (matchId, when, fields) => {
    const doc = records.get(matchId);
    if (doc !== undefined && when(doc)) records.set(matchId, copy({ ...doc, ...fields }));
  };
  const always = () => true;

  return Object.freeze({
    ensureIndexes: async () => {},

    async insertIfAbsent(doc) {
      if (records.has(doc.matchId)) return false;
      records.set(doc.matchId, copy({ ...doc, status: "pending", done: [], attempts: 0 }));
      return true;
    },

    async get(matchId) {
      if (!records.has(matchId)) {
        throw new RangeError(`No pending match ${matchId}`);
      }
      return copy(records.get(matchId));
    },

    async listDue({ now, limit }) {
      return [...records.values()]
        .filter((doc) => doc.status === "pending" && doc.nextAttemptAt <= now)
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
        .slice(0, limit)
        .map(copy);
    },

    async addDone({ matchId, step }) {
      change(matchId, always, { done: [...new Set([...(records.get(matchId)?.done ?? []), step])] });
    },

    async recordFailure({ matchId, status, attempts, nextAttemptAt, lastError }) {
      change(matchId, (doc) => doc.status === "pending" && doc.attempts === attempts - 1, {
        status,
        attempts,
        nextAttemptAt,
        lastError,
        expiresAt: undefined,
      });
    },

    async markDone({ matchId, doneAt, expiresAt }) {
      change(matchId, (doc) => doc.status === "pending", { status: "done", doneAt, expiresAt });
    },
  });
}
