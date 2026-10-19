import mongoose from "mongoose";
import { DuplicateKey, VersionConflict } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;
const FINISHED = ["solved", "failed"];

/**
 * @typedef {Object} DailyPuzzleAttemptDoc  persistence object: one player's attempt at one day's puzzle (CC-144)
 * @property {string} playerId
 * @property {string} kind        the puzzle kind, such as "chess"
 * @property {string} day         the puzzle's day, "YYYY-MM-DD"
 * @property {string} puzzleId    the catalogue id of the day's puzzle
 * @property {string} status      "playing", "solved" or "failed"
 * @property {string[]} found     the player's accepted moves, oldest first
 * @property {number[]} marks     mistakes made at each move to find
 * @property {number} mistakes    mistakes in all
 * @property {number[]} hints     hints taken at each move to find
 * @property {number} streak      the kind's streak once this day ended, 0 while it is being played
 * @property {number} best        the best streak of the kind once this day ended
 * @property {number} version     counts every change, so two changes at once cannot both win
 * @property {Date} startedAt
 * @property {Date} updatedAt
 * @property {Date} [finishedAt]
 */

const attemptSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true },
    kind: { type: String, required: true },
    day: { type: String, required: true },
    puzzleId: { type: String, required: true },
    status: { type: String, required: true },
    found: { type: [String], default: [] },
    marks: { type: [Number], default: [] },
    mistakes: { type: Number, required: true },
    hints: { type: [Number], default: [] },
    streak: { type: Number, required: true },
    best: { type: Number, required: true },
    version: { type: Number, required: true },
    startedAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    finishedAt: { type: Date },
  },
  { collection: "daily_puzzle_attempts", versionKey: false },
);
// One attempt per player, kind and day. It also serves every read, which starts with the player and the kind and
// then walks the days.
attemptSchema.index({ playerId: 1, kind: 1, day: 1 }, { unique: true });

const FIELDS = "-_id";
const isDuplicate = (err) => err.code === DUPLICATE_KEY_CODE;

/**
 * Daily puzzle attempts in MongoDB (CC-144, ADR-061).
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createDailyPuzzleAttemptDao({ connection }) {
  const Attempt = connection.model("DailyPuzzleAttempt", attemptSchema);

  return Object.freeze({
    ensureIndexes: () => Attempt.syncIndexes(),

    /**
     * @param {DailyPuzzleAttemptDoc} attempt
     * @returns {Promise<void>}
     * @throws {DuplicateKey} when the player already has an attempt at that day's puzzle of that kind
     */
    async insert(attempt) {
      try {
        await Attempt.create(attempt);
      } catch (err) {
        if (isDuplicate(err)) {
          throw new DuplicateKey(
            `${attempt.playerId} already has the ${attempt.kind} puzzle of ${attempt.day}`,
            {
              cause: err,
            },
          );
        }
        throw err;
      }
    },

    /**
     * @param {{ playerId: string, kind: string, day: string }} key
     * @returns {Promise<DailyPuzzleAttemptDoc[]>} the attempt, or nothing
     */
    findDay: async ({ playerId, kind, day }) => Attempt.find({ playerId, kind, day }, FIELDS).lean(),

    /**
     * @param {{ playerId: string, kind: string, beforeDay: string }} query
     * @returns {Promise<DailyPuzzleAttemptDoc[]>} the latest solved or failed attempt before that day, or nothing
     */
    findLatestFinished: async ({ playerId, kind, beforeDay }) =>
      Attempt.find({ playerId, kind, day: { $lt: beforeDay }, status: { $in: FINISHED } }, FIELDS)
        .sort({ day: -1 })
        .limit(1)
        .lean(),

    /**
     * Changes an attempt if nobody changed it since it was read, and counts its version up.
     *
     * @param {{ playerId: string, kind: string, day: string, version: number }} key
     * @param {Partial<DailyPuzzleAttemptDoc>} changes
     * @returns {Promise<DailyPuzzleAttemptDoc>} the attempt after the change
     * @throws {VersionConflict} when the attempt is gone or has another version
     */
    async update({ playerId, kind, day, version }, changes) {
      const updated = await Attempt.findOneAndUpdate(
        { playerId, kind, day, version },
        { $set: changes, $inc: { version: 1 } },
        { returnDocument: "after", projection: FIELDS },
      ).lean();
      if (updated === null) {
        throw new VersionConflict(`The ${kind} puzzle of ${day} for ${playerId} changed or is gone`);
      }
      return updated;
    },

    /**
     * @param {string} playerId
     * @returns {Promise<DailyPuzzleAttemptDoc[]>} by kind, then by day, oldest first
     */
    listByPlayer: async (playerId) => Attempt.find({ playerId }, FIELDS).sort({ kind: 1, day: 1 }).lean(),

    /**
     * Gives one day's attempt of `from` to `to`.
     *
     * @param {{ from: string, to: string, kind: string, day: string }} move
     * @returns {Promise<number>} attempts moved: 0 when `from` has none that day
     */
    async reassign({ from, to, kind, day }) {
      const { modifiedCount } = await Attempt.updateOne(
        { playerId: from, kind, day },
        { $set: { playerId: to } },
      );
      return modifiedCount;
    },

    /**
     * @param {{ playerId: string, kind: string, day: string }} key
     * @returns {Promise<number>} attempts deleted
     */
    async deleteDay({ playerId, kind, day }) {
      const { deletedCount } = await Attempt.deleteOne({ playerId, kind, day });
      return deletedCount;
    },

    /**
     * @param {string} playerId
     * @returns {Promise<number>} attempts deleted
     */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await Attempt.deleteMany({ playerId });
      return deletedCount;
    },
  });
}
