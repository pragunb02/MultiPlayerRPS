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
    // Guests whose weekly rows were added to this one (CC-291), and the match and quest keys those rows had
    // counted. They are kept apart from `recentKeys`, so a merge never pushes out the account's own keys.
    mergedFrom: { type: [String], default: undefined },
    mergedKeys: { type: [String], default: undefined },
    updatedAt: { type: Date, required: true },
    expiresAt: { type: Date }, // weekly boards only; MongoDB removes the entry after this time
  },
  { collection: "leaderboard_entries", versionKey: false },
);
entrySchema.index({ board: 1, period: 1, playerId: 1 }, { unique: true });
// The board page: highest score first, earlier on a tie (player id last, so the order is total).
entrySchema.index({ board: 1, period: 1, score: -1, updatedAt: 1, playerId: 1 });
entrySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// One player's rows: export, deletion, and a guest's rows moving or living longer (CC-035, CC-291).
entrySchema.index({ playerId: 1, period: 1 });

const isDuplicate = (err) => err.code === DUPLICATE_KEY_CODE;

/**
 * Leaderboard entries in MongoDB: one document per board, period and player.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createLeaderboardDao({ connection }) {
  const Entry = connection.model("LeaderboardEntry", entrySchema);
  const names = ({ displayName, level }) => ({ displayName, level });

  /** Applies `update` where `filter` still matches, creating the entry when there is none. */
  async function applyOnce(filter, update) {
    try {
      await Entry.updateOne(filter, update, { upsert: true });
      return { applied: true };
    } catch (err) {
      if (!isDuplicate(err)) {
        throw err;
      }
    }
    // Either it was applied already, or another write created the entry just now.
    const { modifiedCount } = await Entry.updateOne(filter, update);
    return { applied: modifiedCount > 0 };
  }

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
      // A key the entry counted itself, or one a merged guest row had counted, is not added again.
      const filter = { board, period, playerId, recentKeys: { $ne: key }, mergedKeys: { $ne: key } };
      const update = {
        $inc: { score: inc },
        $push: { recentKeys: { $each: [key], $slice: -RECENT_KEYS } },
        $set: { updatedAt: at, ...names(player), ...(expiresAt && { expiresAt }) },
      };
      return applyOnce(filter, update);
    },

    /**
     * Adds a guest's weekly row to this entry once per guest (`from`), and remembers `keys`, the match and quest
     * keys the guest's row counted, so none of them is added to this entry again (CC-291).
     *
     * @param {EntryWrite & { from: string, keys: string[], inc: number }} write
     * @returns {Promise<{ applied: boolean }>}
     */
    async mergeOnce({ board, period, playerId, from, keys, inc, at, expiresAt, ...player }) {
      const filter = { board, period, playerId, mergedFrom: { $ne: from } };
      const update = {
        $inc: { score: inc },
        $push: { mergedFrom: from, mergedKeys: { $each: keys, $slice: -RECENT_KEYS } },
        $set: { updatedAt: at, ...names(player), ...(expiresAt && { expiresAt }) },
      };
      return applyOnce(filter, update);
    },

    /**
     * One player's rows of one board, every period, with the keys they counted and when they end (CC-291).
     *
     * @param {{ board: string, playerId: string }} query
     * @returns {Promise<Array<{ period: string, score: number, updatedAt: Date, recentKeys: string[], expiresAt?: Date }>>}
     */
    listWithKeys: ({ board, playerId }) =>
      Entry.find({ board, playerId }, "-_id period score updatedAt recentKeys expiresAt").lean(),

    /**
     * Moves the end of one player's rows of a period to `expiresAt`, only where that is later (CC-291).
     *
     * @param {{ playerId: string, period: string, expiresAt: Date }} change
     * @returns {Promise<number>} rows changed
     */
    async extendLifetime({ playerId, period, expiresAt }) {
      const { modifiedCount } = await Entry.updateMany(
        { playerId, period, expiresAt: { $lt: expiresAt } },
        { $set: { expiresAt } },
      );
      return modifiedCount;
    },

    /**
     * @param {BoardRef & { limit: number, excluding?: ReadonlyArray<string> }} query  `excluding`: players whose
     *   rows are hidden, such as suspended accounts (CC-334)
     * @returns {Promise<LeaderboardEntryDoc[]>} best first
     */
    top: ({ board, period, limit, excluding = [] }) =>
      Entry.find(
        { board, period, ...(excluding.length > 0 && { playerId: { $nin: [...excluding] } }) },
        FIELDS,
      )
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
     * @param {BoardRef & Pick<LeaderboardEntryDoc, "playerId" | "score" | "updatedAt"> & { excluding?: ReadonlyArray<string> }} entry
     *   `excluding`: players whose rows are hidden, who are not counted (CC-334)
     * @returns {Promise<number>}
     */
    countAhead: ({ board, period, playerId, score, updatedAt, excluding = [] }) =>
      Entry.countDocuments({
        board,
        period,
        ...(excluding.length > 0 && { playerId: { $nin: [...excluding] } }),
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
     * Gives every entry of one player a new name, after the owner renamed a reported account (CC-044).
     *
     * @param {{ playerId: string, displayName: string }} change
     * @returns {Promise<number>} entries changed
     */
    async renamePlayer({ playerId, displayName }) {
      const { modifiedCount } = await Entry.updateMany({ playerId }, { $set: { displayName } });
      return modifiedCount;
    },

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
