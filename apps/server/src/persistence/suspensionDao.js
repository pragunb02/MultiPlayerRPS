import mongoose from "mongoose";

/**
 * @typedef {Object} SuspensionDoc  persistence object: the owner suspended one account (CC-334, ADR-078)
 * @property {string} suspensionId   random id, the only id the console sees
 * @property {string} playerId       the suspended account. Never sent to any client
 * @property {string} nameThen       the account's name when it was suspended
 * @property {string} duration       one of SUSPENSION_DURATIONS
 * @property {string} reason         one of SUSPENSION_REASONS
 * @property {Date} startedAt
 * @property {Date | null} endsAt    null while it lasts until lifted
 * @property {string} byId           the admin who suspended. Never sent to any client
 * @property {string} byName         that admin's name then, which the console shows
 * @property {Date} [liftedAt]       when the owner lifted it early
 * @property {string} [liftedById]
 * @property {string} [liftedByName]
 * @property {Date} [deleteAt]       MongoDB removes the record after this: SUSPENSION_KEEP_DAYS after its end or
 *   lift. Left out while a suspension until lifted lasts, so it is never removed then
 */

const suspensionSchema = new mongoose.Schema(
  {
    suspensionId: { type: String, required: true },
    playerId: { type: String, required: true },
    nameThen: { type: String, required: true },
    duration: { type: String, required: true },
    reason: { type: String, required: true },
    startedAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    byId: { type: String, required: true },
    byName: { type: String, required: true },
    liftedAt: { type: Date },
    liftedById: { type: String },
    liftedByName: { type: String },
    deleteAt: { type: Date },
  },
  { collection: "account_suspensions", versionKey: false },
);
suspensionSchema.index({ suspensionId: 1 }, { unique: true });
// One player's history, newest first, and the check at every sign-in.
suspensionSchema.index({ playerId: 1, startedAt: -1 });
// The suspensions in effect: not lifted, and not ended (or until lifted).
suspensionSchema.index({ liftedAt: 1, endsAt: 1 });
// MongoDB deletes a record at its own `deleteAt`, checked about once a minute. Without the field, never.
suspensionSchema.index({ deleteAt: 1 }, { expireAfterSeconds: 0 });

const FIELDS =
  "-_id suspensionId playerId nameThen duration reason startedAt endsAt byId byName liftedAt liftedById liftedByName deleteAt";

/** In effect at `at`: never lifted, and ending after `at` or lasting until lifted. */
const inEffectAt = (at) => ({
  liftedAt: { $exists: false },
  $or: [{ endsAt: null }, { endsAt: { $gt: at } }],
});

/**
 * Account suspensions in MongoDB (CC-334, ADR-078): the one record of each suspension, its history and its audit.
 * A collection of its own; `accounts` is not changed.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createSuspensionDao({ connection }) {
  const Suspension = connection.model("Suspension", suspensionSchema);

  return Object.freeze({
    ensureIndexes: () => Suspension.syncIndexes(),

    /**
     * @param {SuspensionDoc} doc
     * @returns {Promise<SuspensionDoc>}
     */
    async insert(doc) {
      await Suspension.create(doc);
      return Suspension.findOne({ suspensionId: doc.suspensionId }, FIELDS).lean();
    },

    /**
     * @param {string} suspensionId
     * @returns {Promise<SuspensionDoc>}
     * @throws {RangeError} when there is no such suspension
     */
    async getById(suspensionId) {
      const doc = await Suspension.findOne({ suspensionId }, FIELDS).lean();
      if (doc === null) {
        throw new RangeError(`No suspension ${suspensionId}`);
      }
      return doc;
    },

    /**
     * @param {string} playerId
     * @returns {Promise<SuspensionDoc[]>} newest first
     */
    listByPlayer: (playerId) =>
      Suspension.find({ playerId }, FIELDS).sort({ startedAt: -1, suspensionId: -1 }).lean(),

    /**
     * @param {{ at: Date }} query
     * @returns {Promise<SuspensionDoc[]>} the suspensions in effect at that moment, newest first
     */
    listActive: ({ at }) =>
      Suspension.find(inEffectAt(at), FIELDS).sort({ startedAt: -1, suspensionId: -1 }).lean(),

    /**
     * Lifts a suspension that is still in effect at `liftedAt`.
     *
     * @param {{ suspensionId: string, liftedAt: Date, liftedById: string, liftedByName: string, deleteAt: Date }} lift
     * @returns {Promise<boolean>} false when it was not in effect any more, or does not exist
     */
    async lift({ suspensionId, liftedAt, liftedById, liftedByName, deleteAt }) {
      const { modifiedCount } = await Suspension.updateOne(
        { suspensionId, ...inEffectAt(liftedAt) },
        { $set: { liftedAt, liftedById, liftedByName, deleteAt } },
      );
      return modifiedCount === 1;
    },

    /**
     * @param {string} playerId
     * @returns {Promise<number>} records removed
     */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await Suspension.deleteMany({ playerId });
      return deletedCount;
    },
  });
}
