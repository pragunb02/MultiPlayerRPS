import mongoose from "mongoose";

const DUPLICATE_KEY_CODE = 11000;
// Idempotency window: the last N matches applied per player are remembered.
const RECENT_MATCHES = 200;
const MAX_ATTEMPTS = 3;
const COUNTERS = ["xp", "matchesPlayed", "wins", "losses", "draws"];

/**
 * @typedef {{ xp: number, matchesPlayed: number, wins: number, losses: number, draws: number }} ProgressTotals
 * @typedef {ProgressTotals & { playerId: string, updatedAt: Date }} ProgressDoc
 */

const progressSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true, unique: true },
    xp: { type: Number, default: 0 },
    matchesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    recentMatchIds: { type: [String], default: [] },
    updatedAt: { type: Date, required: true },
  },
  { collection: "player_progress", versionKey: false },
);

const ZERO = Object.freeze({ xp: 0, matchesPlayed: 0, wins: 0, losses: 0, draws: 0 });
const totalsOf = (doc) => Object.fromEntries(COUNTERS.map((key) => [key, doc?.[key] ?? 0]));

/**
 * Per-player progress totals in MongoDB.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createProgressDao({ connection }) {
  const Progress = connection.model("Progress", progressSchema);

  return Object.freeze({
    ensureIndexes: () => Progress.syncIndexes(),

    /**
     * Adds a match's counters to a player's totals exactly once, in one atomic operation: the update only
     * matches if this match id was not applied yet; otherwise the upsert collides on `playerId` and nothing
     * changes.
     *
     * @param {{ playerId: string, matchId: string, inc: Partial<ProgressTotals>, at: Date }} change
     * @returns {Promise<{ applied: boolean, before: ProgressTotals }>}
     */
    async applyMatchOnce({ playerId, matchId, inc, at }) {
      for (let attempt = 1; ; attempt++) {
        try {
          const before = await Progress.findOneAndUpdate(
            { playerId, recentMatchIds: { $ne: matchId } },
            {
              $inc: inc,
              $push: { recentMatchIds: { $each: [matchId], $slice: -RECENT_MATCHES } },
              $set: { updatedAt: at },
            },
            { upsert: true, returnDocument: "before", lean: true },
          );
          return { applied: true, before: before === null ? { ...ZERO } : totalsOf(before) };
        } catch (err) {
          if (err.code !== DUPLICATE_KEY_CODE) {
            throw err;
          }
          // The upsert collided on playerId: either this match is already applied, or another match created the
          // player's document at the same moment — then the document now exists and a retry updates it.
          const current = await Progress.findOne({ playerId }).lean();
          if (current?.recentMatchIds.includes(matchId) || attempt >= MAX_ATTEMPTS) {
            return { applied: false, before: totalsOf(current) };
          }
        }
      }
    },

    /**
     * @param {string} playerId
     * @returns {Promise<ProgressDoc>}
     * @throws {RangeError} when the player has no progress yet
     */
    async getByPlayer(playerId) {
      const doc = await Progress.findOne({ playerId }).lean();
      if (doc === null) {
        throw new RangeError(`No progress for ${playerId}`);
      }
      return { playerId, ...totalsOf(doc), updatedAt: doc.updatedAt };
    },
  });
}
