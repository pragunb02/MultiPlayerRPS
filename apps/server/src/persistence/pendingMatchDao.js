const PENDING_MATCHES = "pending_matches";
const WITHOUT_ID = Object.freeze({ projection: { _id: 0 } });

/**
 * @typedef {Object} PendingMatchDoc      persistence object: a finished game on its way through the match pipeline
 * @property {string} matchId
 * @property {Record<string, unknown>} match   the match to record, plain JSON (times as epoch milliseconds)
 * @property {"pending" | "done" | "failed"} status
 * @property {string[]} done              names of the pipeline steps already done
 * @property {number} attempts            failed attempts so far
 * @property {Date} nextAttemptAt
 * @property {{ step: string, message: string }} [lastError]
 * @property {Date} createdAt
 * @property {Date} [doneAt]
 * @property {Date} [expiresAt]           when MongoDB may delete the record. Only a done record has one
 */

/**
 * The match pipeline's outbox in MongoDB (CC-111, ADR-047): one record per finished game, so a database blip or a
 * crash never loses what the game earned. Stored through the driver directly, like rooms: the match inside is
 * engine owned JSON, so a schema here would only get in the way.
 *
 * @param {{ connection: import("mongoose").Connection }} deps
 */
export function createPendingMatchDao({ connection }) {
  const pending = connection.db.collection(PENDING_MATCHES, { ignoreUndefined: true });

  return Object.freeze({
    /** Creates the collection's indexes. Awaited at boot, so the regular look for due games uses an index. */
    async ensureIndexes() {
      await pending.createIndexes([
        { key: { matchId: 1 }, unique: true, name: "match_id_unique" },
        // Every few seconds: pending games whose next attempt is due.
        { key: { status: 1, nextAttemptAt: 1 }, name: "status_next_attempt" },
        // MongoDB deletes a done record once its time is up, about once a minute. Failed records have no time.
        { key: { expiresAt: 1 }, name: "expires_at_ttl", expireAfterSeconds: 0 },
      ]);
    },

    /**
     * Adds a finished game unless it is there already.
     *
     * @param {Pick<PendingMatchDoc, "matchId" | "match" | "createdAt" | "nextAttemptAt">} doc
     * @returns {Promise<boolean>} whether it was added now
     */
    async insertIfAbsent(doc) {
      // Two adds of the same game at the same moment cannot both insert: MongoDB retries the loser of the unique
      // index race as an update, which then finds the record and changes nothing.
      const { upsertedCount } = await pending.updateOne(
        { matchId: doc.matchId },
        { $setOnInsert: { ...structuredClone(doc), status: "pending", done: [], attempts: 0 } },
        { upsert: true },
      );
      return upsertedCount === 1;
    },

    /**
     * @param {string} matchId
     * @returns {Promise<PendingMatchDoc>}
     * @throws {RangeError} when absent
     */
    async get(matchId) {
      const doc = await pending.findOne({ matchId }, WITHOUT_ID);
      if (doc === null) {
        throw new RangeError(`No pending match ${matchId}`);
      }
      return doc;
    },

    /**
     * @param {{ now: Date, limit: number }} query
     * @returns {Promise<PendingMatchDoc[]>} pending games due at `now`, the longest waiting first
     */
    listDue: ({ now, limit }) =>
      pending
        .find({ status: "pending", nextAttemptAt: { $lte: now } }, WITHOUT_ID)
        .sort({ nextAttemptAt: 1 })
        .limit(limit)
        .toArray(),

    /** @param {{ matchId: string, step: string }} done */
    async addDone({ matchId, step }) {
      await pending.updateOne({ matchId }, { $addToSet: { done: step } });
    },

    /**
     * Records the `attempts`th failure. It changes only a pending record that has had one failure less, so a run
     * that read the record before another run changed it can neither undo a finish nor count an attempt twice.
     * A record that fails for good never expires.
     *
     * @param {Pick<PendingMatchDoc, "matchId" | "status" | "attempts" | "nextAttemptAt" | "lastError">} failure
     */
    async recordFailure({ matchId, status, attempts, nextAttemptAt, lastError }) {
      await pending.updateOne(
        { matchId, status: "pending", attempts: attempts - 1 },
        { $set: { status, attempts, nextAttemptAt, lastError }, $unset: { expiresAt: "" } },
      );
    },

    /**
     * Marks a pending record done. A record that is done or failed already stays as it is.
     *
     * @param {{ matchId: string, doneAt: Date, expiresAt: Date }} done
     */
    async markDone({ matchId, doneAt, expiresAt }) {
      await pending.updateOne(
        { matchId, status: "pending" },
        { $set: { status: "done", doneAt, expiresAt } },
      );
    },
  });
}
