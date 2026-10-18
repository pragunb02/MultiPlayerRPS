import mongoose from "mongoose";

/**
 * @typedef {Object} AccountDeletionDoc   persistence object: one account that was deleted (CC-035)
 * @property {string} playerId              the deleted account's player id, which leads nowhere any more
 * @property {Date} requestedAt
 * @property {Date} [sweepAgainAt]          when housekeeping erases once more. Gone after that sweep
 * @property {Date} expiresAt               MongoDB removes the record after this time
 */

const deletionSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true, unique: true },
    requestedAt: { type: Date, required: true },
    sweepAgainAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { collection: "account_deletions", versionKey: false },
);
// MongoDB deletes the record once `expiresAt` has passed.
deletionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// No index for the sweep: the collection holds at most 30 days of deletions.

// Only the legacy row's id and when it was closed. The row itself is never written (CC-078).
const closureSchema = new mongoose.Schema(
  {
    legacyId: { type: String, required: true, unique: true },
    closedAt: { type: Date, required: true },
  },
  { collection: "legacy_closures", versionKey: false },
);

/**
 * Deleted accounts in MongoDB: a short lived record so a deletion is finished for sure, and the legacy rows whose
 * player deleted their account, so the legacy login cannot bring the account back.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createAccountDeletionDao({ connection }) {
  const Deletion = connection.model("AccountDeletion", deletionSchema);
  const Closure = connection.model("LegacyClosure", closureSchema);

  return Object.freeze({
    ensureIndexes: () => Promise.all([Deletion.syncIndexes(), Closure.syncIndexes()]),

    /**
     * Records a deletion. A player recorded already keeps the first record, so asking twice changes nothing.
     *
     * @param {{ playerId: string, requestedAt: Date, sweepAgainAt: Date, expiresAt: Date }} deletion
     */
    async insert({ playerId, requestedAt, sweepAgainAt, expiresAt }) {
      await Deletion.updateOne(
        { playerId },
        { $setOnInsert: { playerId, requestedAt, sweepAgainAt, expiresAt } },
        { upsert: true },
      );
    },

    /**
     * Deletions whose second sweep is due, the earliest first.
     *
     * @param {{ now: Date, limit: number }} query
     * @returns {Promise<Array<{ playerId: string, requestedAt: Date }>>}
     */
    listDue: ({ now, limit }) =>
      Deletion.find({ sweepAgainAt: { $lte: now } }, { _id: 0, playerId: 1, requestedAt: 1 })
        .sort({ sweepAgainAt: 1 })
        .limit(limit)
        .lean(),

    /** @param {string} playerId */
    async markSwept(playerId) {
      await Deletion.updateOne({ playerId }, { $unset: { sweepAgainAt: "" } });
    },

    /**
     * Notes that the player of this legacy row deleted their account. Closing it again changes nothing.
     *
     * @param {{ legacyId: string, closedAt: Date }} closure
     */
    async closeLegacy({ legacyId, closedAt }) {
      await Closure.updateOne({ legacyId }, { $setOnInsert: { legacyId, closedAt } }, { upsert: true });
    },

    /** @param {string} legacyId */
    isLegacyClosed: async (legacyId) => (await Closure.countDocuments({ legacyId }, { limit: 1 })) === 1,
  });
}
