import mongoose from "mongoose";
import { DuplicateKey, VersionConflict } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;

/**
 * @typedef {{ rating: number, deviation: number, volatility: number }} GlickoDoc
 * @typedef {{ matchId: string, at: Date, before: GlickoDoc, after: GlickoDoc, superseded?: boolean }} RatingChangeDoc
 * @typedef {GlickoDoc & {
 *   games: number,
 *   lastRatedAt?: Date,
 *   seed?: { level: string, at: Date },
 *   changes: RatingChangeDoc[],
 *   mergedFrom: string[],
 *   updatedAt: Date,
 * }} ChessRatingFields   what the accessor writes
 * @typedef {ChessRatingFields & { playerId: string, revision: number, mergedInto?: string }} ChessRatingDoc
 */

const glicko = { _id: false, rating: Number, deviation: Number, volatility: Number };

const chessRatingSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true, unique: true },
    rating: { type: Number, required: true },
    deviation: { type: Number, required: true },
    volatility: { type: Number, required: true },
    // Rated games played. Under 10 the rating is provisional (ADR-027).
    games: { type: Number, required: true },
    lastRatedAt: { type: Date },
    // The level picked against Queen Vee that set the starting rating, while no rated game has been played (ADR-062).
    seed: { type: new mongoose.Schema({ level: String, at: Date }, { _id: false }) },
    // The last 200 changes. A match found here is never rated again, and its `before` is what the opponent is
    // rated against when the step runs again (ADR-062).
    changes: {
      type: [
        new mongoose.Schema(
          { matchId: String, at: Date, before: glicko, after: glicko, superseded: Boolean },
          { _id: false },
        ),
      ],
      default: [],
    },
    // Counted up by every write. A write names the revision it read and fails when another came first.
    revision: { type: Number, required: true },
    // On a guest's document after it moved to an account (ADR-014): a late game is rated on the account.
    mergedInto: { type: String, index: { sparse: true } },
    mergedFrom: { type: [String], default: [] },
    updatedAt: { type: Date, required: true },
  },
  { collection: "chess_ratings", versionKey: false },
);

/** The document without Mongo's own fields, and without the optional ones it does not have. */
function plain({ _id, ...doc }) {
  return Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined && value !== null));
}

/**
 * Chess ratings in MongoDB, one document per player (CC-042, ADR-062). Every write replaces the whole rating and
 * is guarded by the revision it was read at, so two games that end at once can never overwrite each other.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createChessRatingDao({ connection }) {
  const ChessRating = connection.model("ChessRating", chessRatingSchema);

  return Object.freeze({
    ensureIndexes: () => ChessRating.syncIndexes(),

    /**
     * @param {string} playerId
     * @returns {Promise<ChessRatingDoc>}
     * @throws {RangeError} when the player has no rating document
     */
    async getByPlayer(playerId) {
      const doc = await ChessRating.findOne({ playerId }).lean();
      if (doc === null) {
        throw new RangeError(`No chess rating for ${playerId}`);
      }
      return plain(doc);
    },

    /**
     * Writes a player's whole rating. Revision 0 creates it. Any other revision replaces the document only while
     * it is still at that revision and has not moved to an account.
     *
     * @param {{ playerId: string, revision: number, doc: ChessRatingFields }} write
     * @throws {VersionConflict} when another write came first, or the guest's rating has moved
     */
    async write({ playerId, revision, doc }) {
      if (revision === 0) {
        try {
          await ChessRating.create({ ...doc, playerId, revision: 1 });
          return;
        } catch (err) {
          if (err.code === DUPLICATE_KEY_CODE) {
            throw new VersionConflict(`The chess rating of ${playerId} exists already`, { cause: err });
          }
          throw err;
        }
      }
      const { matchedCount } = await ChessRating.replaceOne(
        { playerId, revision, mergedInto: { $exists: false } },
        { ...doc, playerId, revision: revision + 1 },
        { runValidators: true },
      );
      if (matchedCount === 0) {
        throw new VersionConflict(`The chess rating of ${playerId} changed since revision ${revision}`);
      }
    },

    /**
     * Marks a guest's rating as moved to an account (ADR-014), creating an empty one when the guest had none, so a
     * game that ends during the sign in still finds the account. Marking for the same account again changes nothing.
     *
     * @param {{ from: string, to: string, at: Date }} merge
     * @returns {Promise<ChessRatingDoc>} the guest's document as marked
     * @throws {DuplicateKey} when the guest's rating moved to another player
     */
    async markMergedInto({ from, to, at }) {
      try {
        const doc = await ChessRating.findOneAndUpdate(
          { playerId: from, mergedInto: { $exists: false } },
          {
            $set: { mergedInto: to, updatedAt: at },
            $inc: { revision: 1 },
            $setOnInsert: { rating: 1500, deviation: 350, volatility: 0.06, games: 0 },
          },
          { upsert: true, returnDocument: "after", lean: true },
        );
        return plain(doc);
      } catch (err) {
        if (err.code !== DUPLICATE_KEY_CODE) {
          throw err;
        }
        // Marked already: by this move, run again or at the same time, or by a move to someone else.
        const current = await ChessRating.findOne({ playerId: from }).lean();
        if (current.mergedInto === to) {
          return plain(current);
        }
        throw new DuplicateKey(`The chess rating of ${from} moved to another player`, { cause: err });
      }
    },

    /**
     * Deletes a player's rating and the markers of guests who moved into it (CC-035).
     *
     * @param {string} playerId
     * @returns {Promise<number>} documents removed
     */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await ChessRating.deleteMany({
        $or: [{ playerId }, { mergedInto: playerId }],
      });
      return deletedCount;
    },
  });
}
