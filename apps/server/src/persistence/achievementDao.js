import mongoose from "mongoose";

const FIELDS = "-_id playerId achievementId unlockedAt matchId";

/**
 * @typedef {{ playerId: string, achievementId: string, unlockedAt: Date, matchId: string }} UnlockDoc
 */

const unlockSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true },
    achievementId: { type: String, required: true },
    unlockedAt: { type: Date, required: true },
    matchId: { type: String, default: "" },
  },
  { collection: "player_achievements", versionKey: false },
);
unlockSchema.index({ playerId: 1, achievementId: 1 }, { unique: true });
// The owner console: "achievements unlocked in this range" (CC-233).
unlockSchema.index({ unlockedAt: 1 });

/**
 * Unlocked achievements in MongoDB (CC-054): one document per player and achievement, so an achievement can
 * never be unlocked twice.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createAchievementDao({ connection }) {
  const Unlock = connection.model("PlayerAchievement", unlockSchema);

  return Object.freeze({
    ensureIndexes: () => Unlock.syncIndexes(),

    /**
     * @param {string} playerId
     * @returns {Promise<UnlockDoc[]>} oldest first
     */
    listByPlayer(playerId) {
      return Unlock.find({ playerId }, FIELDS).sort({ unlockedAt: 1, achievementId: 1 }).lean();
    },

    /**
     * Records an unlock. If the player already has it, keeps the earlier time (merging a guest into an account
     * keeps the first time either of them earned it).
     *
     * @param {UnlockDoc} doc
     * @returns {Promise<{ created: boolean }>}
     */
    async upsertEarliest({ playerId, achievementId, unlockedAt, matchId }) {
      // Two unlocks racing can't fail on the unique index: the filter is exactly its keys (equality only), so
      // MongoDB (4.2+) retries the losing upsert as an update itself. Exactly one of them reports `created`.
      const { upsertedCount } = await Unlock.updateOne(
        { playerId, achievementId },
        { $min: { unlockedAt }, $setOnInsert: { matchId } },
        { upsert: true },
      );
      return { created: upsertedCount === 1 };
    },

    /**
     * @param {string} playerId
     * @returns {Promise<number>} unlocks removed
     */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await Unlock.deleteMany({ playerId });
      return deletedCount;
    },
  });
}
