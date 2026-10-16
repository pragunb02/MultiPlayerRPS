import mongoose from "mongoose";
import { DuplicateKey } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;
// Idempotency window: the last N matches applied per player are remembered.
const RECENT_MATCHES = 200;
const MAX_ATTEMPTS = 3;
const COUNTERS = ["xp", "matchesPlayed", "wins", "losses", "draws"];

/**
 * @typedef {{ xp: number, matchesPlayed: number, wins: number, losses: number, draws: number }} ProgressTotals
 * @typedef {ProgressTotals & { playerId: string, updatedAt: Date }} ProgressDoc
 * @typedef {{ applied: boolean, before: ProgressTotals, mergedInto?: string }} ApplyResult
 *   `mergedInto`: the player's progress has moved to that account (nothing applied here)
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
    // CC-032: a guest's document, once moved to an account, stays as a marker naming the account — so a match that
    // finishes during the move still lands on the account.
    mergedInto: { type: String },
    // An account's document lists the guests merged into it, so each guest is added exactly once.
    mergedFrom: { type: [String], default: [] },
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
     * A player whose progress moved to an account (CC-032) gets nothing applied; the answer names the account.
     *
     * @param {{ playerId: string, matchId: string, inc: Partial<ProgressTotals>, at: Date }} change
     * @returns {Promise<ApplyResult>}
     */
    async applyMatchOnce({ playerId, matchId, inc, at }) {
      for (let attempt = 1; ; attempt++) {
        try {
          const before = await Progress.findOneAndUpdate(
            { playerId, recentMatchIds: { $ne: matchId }, mergedInto: { $exists: false } },
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
          if (current?.mergedInto !== undefined) {
            return { applied: false, before: totalsOf(current), mergedInto: current.mergedInto };
          }
          if (current?.recentMatchIds.includes(matchId) || attempt >= MAX_ATTEMPTS) {
            return { applied: false, before: totalsOf(current) };
          }
        }
      }
    },

    /**
     * Step 1 of moving a guest's progress to an account (CC-032): marks the guest's document as moved — creating
     * an empty one if the guest has none, so later matches still find the marker — and returns what it holds.
     * Marking for the same account again returns the same totals.
     *
     * @param {{ from: string, to: string, at: Date }} merge
     * @returns {Promise<{ totals: ProgressTotals, recentMatchIds: string[] }>}
     * @throws {DuplicateKey} when the guest's progress already moved to a different player
     */
    async markMergedInto({ from, to, at }) {
      const marked = (doc) => ({ totals: totalsOf(doc), recentMatchIds: doc.recentMatchIds });
      try {
        const doc = await Progress.findOneAndUpdate(
          { playerId: from, mergedInto: { $exists: false } },
          { $set: { mergedInto: to }, $setOnInsert: { updatedAt: at } },
          { upsert: true, returnDocument: "after", lean: true },
        );
        return marked(doc);
      } catch (err) {
        if (err.code !== DUPLICATE_KEY_CODE) {
          throw err;
        }
        // The guest is marked already (documents are never deleted): by this move — run again, or concurrently —
        // or by a move to someone else.
        const current = await Progress.findOne({ playerId: from }).lean();
        if (current.mergedInto === to) {
          return marked(current);
        }
        throw new DuplicateKey(`Progress of ${from} already moved to another player`, { cause: err });
      }
    },

    /**
     * Step 2: adds a marked guest's totals to the account, exactly once per guest (the account remembers whom it
     * merged), and remembers the guest's recent matches so none of them is applied to the account again.
     *
     * @param {{ to: string, from: string, totals: ProgressTotals, recentMatchIds: string[], at: Date }} merge
     * @returns {Promise<{ applied: boolean }>}
     */
    async addMerged({ to, from, totals, recentMatchIds, at }) {
      for (let attempt = 1; ; attempt++) {
        try {
          await Progress.updateOne(
            { playerId: to, mergedFrom: { $ne: from } },
            {
              $inc: totals,
              $push: {
                mergedFrom: from,
                recentMatchIds: { $each: recentMatchIds, $slice: -RECENT_MATCHES },
              },
              $set: { updatedAt: at },
            },
            { upsert: true },
          );
          return { applied: true };
        } catch (err) {
          if (err.code !== DUPLICATE_KEY_CODE) {
            throw err;
          }
          // Already merged — or the account's document was created at the same moment (with an empty
          // `mergedFrom`); then a retry adds to it. Documents from before CC-032 lack `mergedFrom` but never collide:
          // `$ne` matches them.
          const current = await Progress.findOne({ playerId: to }).lean();
          if (current.mergedFrom.includes(from) || attempt >= MAX_ATTEMPTS) {
            return { applied: false };
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
