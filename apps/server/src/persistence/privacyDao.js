import mongoose from "mongoose";

/**
 * @typedef {Object} PrivacyDoc   persistence object: one player's privacy switches (CC-052, then CC-278)
 * @property {string} playerId
 * @property {boolean} appearOffline   friends see the player as offline whatever they do
 * @property {Date} updatedAt
 */

const privacySchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true },
    appearOffline: { type: Boolean, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: "player_privacy", versionKey: false },
);
privacySchema.index({ playerId: 1 }, { unique: true });

const FIELDS = "-_id playerId appearOffline updatedAt";

/**
 * Players' privacy switches in MongoDB (CC-052, ADR-066). Appear offline is the first. CC-278 adds the others to
 * the same document. A new collection: nothing existing is read or changed.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createPrivacyDao({ connection }) {
  const Privacy = connection.model("PlayerPrivacy", privacySchema);

  return Object.freeze({
    ensureIndexes: () => Privacy.syncIndexes(),

    /**
     * @param {ReadonlyArray<string>} playerIds
     * @returns {Promise<PrivacyDoc[]>} the switches of those who set any, in no particular order
     */
    findByPlayers: (playerIds) => Privacy.find({ playerId: { $in: [...playerIds] } }, FIELDS).lean(),

    /**
     * Sets the player's switches, making their document when they have none. Running it twice changes nothing more.
     *
     * @param {PrivacyDoc} privacy
     * @returns {Promise<PrivacyDoc>}
     */
    set: ({ playerId, appearOffline, updatedAt }) =>
      Privacy.findOneAndUpdate(
        { playerId },
        { $set: { appearOffline, updatedAt } },
        { upsert: true, returnDocument: "after" },
      )
        .select(FIELDS)
        .lean(),

    /** @param {string} playerId @returns {Promise<number>} documents deleted */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await Privacy.deleteOne({ playerId });
      return deletedCount;
    },
  });
}
