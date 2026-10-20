import mongoose from "mongoose";

/**
 * @typedef {Object} FlagOverrideDoc   persistence object: the owner's rollout for one flag (CC-312, ADR-073)
 * @property {string} name             the flag's name in packages/shared/src/flags.js
 * @property {"off" | "on" | number} rollout
 * @property {Date} updatedAt          when the owner last set it
 *
 * @typedef {Object} FlagCountDoc      persistence object: one India day of one side of one flag. No id of anyone
 * @property {string} flag
 * @property {string} day              YYYY-MM-DD in India time
 * @property {"on" | "off"} side
 * @property {number} exposures        times the flag was worked out on this side
 * @property {number} successes        success events on this side
 * @property {Date} expiresAt          MongoDB removes the row after this
 */

const overrideSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    rollout: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: "feature_flags", versionKey: false },
);
overrideSchema.index({ name: 1 }, { unique: true });

const countSchema = new mongoose.Schema(
  {
    flag: { type: String, required: true },
    day: { type: String, required: true },
    side: { type: String, required: true },
    exposures: { type: Number, required: true },
    successes: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: "feature_flag_counts", versionKey: false },
);
countSchema.index({ flag: 1, day: 1, side: 1 }, { unique: true });
// MongoDB deletes a day's counts once its expiresAt has passed, checked about once a minute.
countSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OVERRIDE_FIELDS = "-_id name rollout updatedAt";

/**
 * Feature flag overrides and counts in MongoDB (CC-312, ADR-073). Two collections of their own, which nothing else
 * reads or writes.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createFeatureFlagDao({ connection }) {
  const Override = connection.model("FeatureFlag", overrideSchema);
  const Count = connection.model("FeatureFlagCount", countSchema);

  return Object.freeze({
    ensureIndexes: () => Promise.all([Override.syncIndexes(), Count.syncIndexes()]),

    /** @returns {Promise<FlagOverrideDoc[]>} */
    listOverrides: () => Override.find({}, OVERRIDE_FIELDS).lean(),

    /**
     * Sets the rollout of a flag, making its document the first time.
     *
     * @param {FlagOverrideDoc} override
     * @returns {Promise<FlagOverrideDoc>} as stored
     */
    setOverride: ({ name, rollout, updatedAt }) =>
      Override.findOneAndUpdate(
        { name },
        { $set: { rollout, updatedAt } },
        { upsert: true, returnDocument: "after" },
      )
        .select(OVERRIDE_FIELDS)
        .lean(),

    /**
     * @param {string} name
     * @returns {Promise<number>} overrides removed: 0 when there was none
     */
    async clearOverride(name) {
      const { deletedCount } = await Override.deleteOne({ name });
      return deletedCount;
    },

    /**
     * Adds each row's numbers to its day, flag and side, making the row the first time.
     *
     * @param {ReadonlyArray<FlagCountDoc>} rows
     */
    async addCounts(rows) {
      if (rows.length === 0) return;
      await Count.bulkWrite(
        rows.map(({ flag, day, side, exposures, successes, expiresAt }) => ({
          updateOne: {
            filter: { flag, day, side },
            update: { $inc: { exposures, successes }, $setOnInsert: { expiresAt } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    },

    /**
     * The totals of each flag and side from a day on.
     *
     * @param {string} fromDay  YYYY-MM-DD, included
     * @returns {Promise<Array<{ flag: string, side: string, exposures: number, successes: number }>>}
     */
    countsSince: (fromDay) =>
      Count.aggregate([
        { $match: { day: { $gte: fromDay } } },
        {
          $group: {
            _id: { flag: "$flag", side: "$side" },
            exposures: { $sum: "$exposures" },
            successes: { $sum: "$successes" },
          },
        },
        { $project: { _id: 0, flag: "$_id.flag", side: "$_id.side", exposures: 1, successes: 1 } },
      ]),
  });
}
