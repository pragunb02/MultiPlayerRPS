import mongoose from "mongoose";

const DUPLICATE_KEY_CODE = 11000;
const FIELDS = "-_id -__v";

/**
 * @typedef {Object} QuestItemDoc
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} counts
 * @property {string | null} gameId
 * @property {number} target
 * @property {number} bonusXp
 * @property {number} progress
 * @property {number | null} completedAt   ms
 * @property {string[]} seenGames
 * @property {number} run
 *
 * @typedef {Object} QuestDayDoc
 * @property {string} playerId
 * @property {string} day                  "YYYY-MM-DD" (UTC)
 * @property {QuestItemDoc[]} items
 * @property {number | null} sweepAt       ms
 * @property {string[]} recentKeys         match ids already applied to this day
 * @property {Date} expiresAt              MongoDB removes the document after this (TTL index)
 * @property {number} version              optimistic concurrency: bumped by every save
 */

const itemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    counts: { type: String, required: true },
    gameId: { type: String, default: null },
    target: { type: Number, required: true },
    bonusXp: { type: Number, required: true },
    progress: { type: Number, required: true },
    completedAt: { type: Number, default: null },
    seenGames: { type: [String], default: [] },
    run: { type: Number, default: 0 },
  },
  { _id: false },
);

const questDaySchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true },
    day: { type: String, required: true },
    items: { type: [itemSchema], default: [] },
    sweepAt: { type: Number, default: null },
    recentKeys: { type: [String], default: [] },
    expiresAt: { type: Date, required: true },
    version: { type: Number, required: true },
  },
  { collection: "player_quests", minimize: false, versionKey: false },
);
questDaySchema.index({ playerId: 1, day: 1 }, { unique: true });
questDaySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Each player's daily quest snapshots in MongoDB (CC-089). Old days expire on their own (TTL).
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createQuestDao({ connection }) {
  const QuestDay = connection.model("PlayerQuestDay", questDaySchema);

  return Object.freeze({
    ensureIndexes: () => QuestDay.syncIndexes(),

    /**
     * @param {{ playerId: string, day: string }} key
     * @returns {Promise<QuestDayDoc>}
     * @throws {RangeError} when that day has no snapshot yet
     */
    async findDay({ playerId, day }) {
      const doc = await QuestDay.findOne({ playerId, day }, FIELDS).lean();
      if (doc === null) {
        throw new RangeError(`No quests for ${playerId} on ${day}`);
      }
      return doc;
    },

    /**
     * Saves the day if it is still at `expectedVersion` (0 = it must not exist yet).
     *
     * @param {{ doc: Omit<QuestDayDoc, "version">, expectedVersion: number }} write
     * @returns {Promise<boolean>} false when someone else saved first
     */
    async save({ doc, expectedVersion }) {
      const version = expectedVersion + 1;
      if (expectedVersion === 0) {
        try {
          await QuestDay.create({ ...doc, version });
          return true;
        } catch (err) {
          if (err.code === DUPLICATE_KEY_CODE) {
            return false;
          }
          throw err;
        }
      }
      const { matchedCount } = await QuestDay.replaceOne(
        { playerId: doc.playerId, day: doc.day, version: expectedVersion },
        { ...doc, version },
      );
      return matchedCount === 1;
    },

    /**
     * @param {string} playerId
     * @returns {Promise<number>} days removed
     */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await QuestDay.deleteMany({ playerId });
      return deletedCount;
    },

    /**
     * Every quest day of one player still stored, oldest first, for their data export (CC-035).
     *
     * @param {string} playerId
     * @returns {Promise<QuestDayDoc[]>}
     */
    listByPlayer: (playerId) => QuestDay.find({ playerId }, FIELDS).sort({ day: 1 }).lean(),
  });
}
