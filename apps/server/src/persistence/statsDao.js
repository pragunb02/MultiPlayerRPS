import mongoose from "mongoose";

const DUPLICATE_KEY_CODE = 11000;
const FIELDS = "-_id -__v";

/**
 * @typedef {Object} StatsDoc
 * @property {string} playerId
 * @property {Record<string, number>} winsByGame
 * @property {Record<string, number>} matchesByGame
 * @property {number} checkmateWins
 * @property {number} questsCompleted
 * @property {{ current: number, best: number }} winStreak
 * @property {{ current: number, best: number, lastDay: string }} dailyStreak
 * @property {string[]} recentKeys    exactly-once window: the last keys (match ids, quest keys) applied
 * @property {string[]} mergedFrom
 * @property {Date} updatedAt
 * @property {number} version         optimistic concurrency: bumped by every save
 */

const streak = () => ({ current: { type: Number, default: 0 }, best: { type: Number, default: 0 } });
const statsSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true, unique: true },
    winsByGame: { type: mongoose.Schema.Types.Mixed, default: {} },
    matchesByGame: { type: mongoose.Schema.Types.Mixed, default: {} },
    checkmateWins: { type: Number, default: 0 },
    questsCompleted: { type: Number, default: 0 },
    winStreak: streak(),
    dailyStreak: { ...streak(), lastDay: { type: String, default: "" } },
    recentKeys: { type: [String], default: [] },
    mergedFrom: { type: [String], default: [] },
    updatedAt: { type: Date, required: true },
    version: { type: Number, required: true },
  },
  { collection: "player_stats", minimize: false, versionKey: false },
);

/**
 * Per-player gamification stats in MongoDB (CC-054). Writes are compare-and-set on `version`, so concurrent
 * updates never overwrite each other: the loser re-reads and tries again (in the data layer).
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createStatsDao({ connection }) {
  const Stats = connection.model("PlayerStats", statsSchema);

  return Object.freeze({
    ensureIndexes: () => Stats.syncIndexes(),

    /**
     * @param {string} playerId
     * @returns {Promise<StatsDoc>}
     * @throws {RangeError} when the player has no stats yet
     */
    async findByPlayer(playerId) {
      const doc = await Stats.findOne({ playerId }, FIELDS).lean();
      if (doc === null) {
        throw new RangeError(`No stats for ${playerId}`);
      }
      return doc;
    },

    /**
     * Saves the document if it is still at `expectedVersion` (0 = it must not exist yet).
     *
     * @param {{ doc: Omit<StatsDoc, "version">, expectedVersion: number }} write
     * @returns {Promise<boolean>} false when someone else saved first
     */
    async save({ doc, expectedVersion }) {
      const version = expectedVersion + 1;
      if (expectedVersion === 0) {
        try {
          await Stats.create({ ...doc, version });
          return true;
        } catch (err) {
          if (err.code === DUPLICATE_KEY_CODE) {
            return false;
          }
          throw err;
        }
      }
      const { matchedCount } = await Stats.replaceOne(
        { playerId: doc.playerId, version: expectedVersion },
        { ...doc, version },
      );
      return matchedCount === 1;
    },

    /**
     * @param {string} playerId
     * @returns {Promise<number>} documents removed (0 or 1)
     */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await Stats.deleteOne({ playerId });
      return deletedCount;
    },
  });
}
