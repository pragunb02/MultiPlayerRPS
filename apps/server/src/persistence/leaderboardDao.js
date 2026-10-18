import mongoose from "mongoose";

const DUPLICATE_KEY_CODE = 11000;
// Idempotency window: the last N keys (match ids, quest keys) added per entry are remembered.
const RECENT_KEYS = 200;
const FIELDS = "-_id playerId displayName level score updatedAt";

/**
 * @typedef {Object} LeaderboardEntryDoc   persistence object
 * @property {string} playerId
 * @property {string} displayName
 * @property {number} level
 * @property {number} score
 * @property {Date} updatedAt               when the score last changed: on a tie, earlier ranks higher
 *
 * @typedef {{ board: string, period: string }} BoardRef   e.g. { board: "wins:chess", period: "all" }
 * @typedef {BoardRef & { playerId: string, displayName: string, level: number, at: Date, expiresAt?: Date }} EntryWrite
 */

const entrySchema = new mongoose.Schema(
  {
    board: { type: String, required: true },
    period: { type: String, required: true },
    playerId: { type: String, required: true },
    displayName: { type: String, required: true },
    level: { type: Number, required: true },
    score: { type: Number, required: true },
    recentKeys: { type: [String], default: [] },
    updatedAt: { type: Date, required: true },
    expiresAt: { type: Date }, // weekly boards only; MongoDB removes the entry after this time
  },
  { collection: "leaderboard_entries", versionKey: false },
);
entrySchema.index({ board: 1, period: 1, playerId: 1 }, { unique: true });
// The board page: highest score first, earlier on a tie (player id last, so the order is total).
entrySchema.index({ board: 1, period: 1, score: -1, updatedAt: 1, playerId: 1 });
entrySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const isDuplicate = (err) => err.code === DUPLICATE_KEY_CODE;

/**
 * Leaderboard entries in MongoDB: one document per board, period and player.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createLeaderboardDao({ connection }) {
  const Entry = connection.model("LeaderboardEntry", entrySchema);
  const names = ({ displayName, level }) => ({ displayName, level });

  return Object.freeze({
    ensureIndexes: () => Entry.syncIndexes(),

    /**
     * Sets an entry's score to `score` if that is higher than what it has (creating the entry), and refreshes the
     * player's name and level either way. Applying the same total again changes nothing, so it is idempotent.
     *
     * @param {EntryWrite & { score: number }} write
     * @returns {Promise<{ raised: boolean }>}
     */
    async raiseScore({ board, period, playerId, score, at, expiresAt, ...player }) {
      const filter = { board, period, playerId, score: { $lt: score } };
      const update = { $set: { score, updatedAt: at, ...names(player), ...(expiresAt && { expiresAt }) } };
      try {
        await Entry.updateOne(filter, update, { upsert: true });
        return { raised: true };
      } catch (err) {
        if (!isDuplicate(err)) {
          throw err;
        }
      }
      // The entry exists: raise it if it is still lower (another write may have created it just now).
      const { modifiedCount } = await Entry.updateOne(filter, update);
      if (modifiedCount === 0) {
        await Entry.updateOne({ board, period, playerId }, { $set: names(player) });
      }
      return { raised: modifiedCount > 0 };
    },

    /**
     * Adds `inc` to an entry's score at most once per `key` (creating the entry from zero).
     *
     * @param {EntryWrite & { key: string, inc: number }} write
     * @returns {Promise<{ applied: boolean }>}
     */
    async addOnce({ board, period, playerId, key, inc, at, expiresAt, ...player }) {
      const filter = { board, period, playerId, recentKeys: { $ne: key } };
      const update = {
        $inc: { score: inc },
        $push: { recentKeys: { $each: [key], $slice: -RECENT_KEYS } },
        $set: { updatedAt: at, ...names(player), ...(expiresAt && { expiresAt }) },
      };
      try {
        await Entry.updateOne(filter, update, { upsert: true });
        return { applied: true };
      } catch (err) {
        if (!isDuplicate(err)) {
          throw err;
        }
      }
      // Either the key was applied already, or another write created the entry just now.
      const { modifiedCount } = await Entry.updateOne(filter, update);
      return { applied: modifiedCount > 0 };
    },

    /**
     * @param {BoardRef & { limit: number }} query
     * @returns {Promise<LeaderboardEntryDoc[]>} best first
     */
    top: ({ board, period, limit }) =>
      Entry.find({ board, period }, FIELDS)
        .sort({ score: -1, updatedAt: 1, playerId: 1 })
        .limit(limit)
        .lean(),

    /**
     * @param {BoardRef & { playerId: string }} query
     * @returns {Promise<LeaderboardEntryDoc>}
     * @throws {RangeError} when the player has no entry on that board
     */
    async getEntry({ board, period, playerId }) {
      const doc = await Entry.findOne({ board, period, playerId }, FIELDS).lean();
      if (doc === null) {
        throw new RangeError(`No ${board} ${period} entry for ${playerId}`);
      }
      return doc;
    },

    /**
     * How many entries rank above this one (higher score; on a tie, earlier — then lower player id).
     *
     * @param {BoardRef & Pick<LeaderboardEntryDoc, "playerId" | "score" | "updatedAt">} entry
     * @returns {Promise<number>}
     */
    countAhead: ({ board, period, playerId, score, updatedAt }) =>
      Entry.countDocuments({
        board,
        period,
        $or: [
          { score: { $gt: score } },
          { score, updatedAt: { $lt: updatedAt } },
          { score, updatedAt, playerId: { $lt: playerId } },
        ],
      }),

    /**
     * Every entry of one player, on every board and period, for their data export (CC-035).
     *
     * @param {string} playerId
     * @returns {Promise<Array<LeaderboardEntryDoc & BoardRef>>}
     */
    listByPlayer: (playerId) =>
      Entry.find({ playerId }, `${FIELDS} board period`).sort({ board: 1, period: 1 }).lean(),

    /**
     * Deletes every entry of one player (CC-035).
     *
     * @param {string} playerId
     * @returns {Promise<number>} entries removed
     */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await Entry.deleteMany({ playerId });
      return deletedCount;
    },
  });
}
