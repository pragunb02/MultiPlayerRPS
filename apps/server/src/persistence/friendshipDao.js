import mongoose from "mongoose";
import { DuplicateKey } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;

/**
 * @typedef {Object} FriendshipDoc   persistence object: two players are friends (CC-052)
 * @property {string} low             the smaller of the two player ids, so each pair is written one way only
 * @property {string} high            the larger of the two player ids
 * @property {Date} createdAt
 */

const friendshipSchema = new mongoose.Schema(
  {
    low: { type: String, required: true },
    high: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: "friendships", versionKey: false },
);
// One record per pair. It also finds the friends of the player whose id is the smaller one.
friendshipSchema.index({ low: 1, high: 1 }, { unique: true });
// The friends of the player whose id is the larger one.
friendshipSchema.index({ high: 1 });

const FIELDS = "-_id low high createdAt";
const involving = (playerId) => ({ $or: [{ low: playerId }, { high: playerId }] });

/**
 * Friendships in MongoDB (CC-052, ADR-066). A new collection: nothing existing is read or changed.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createFriendshipDao({ connection }) {
  const Friendship = connection.model("Friendship", friendshipSchema);

  return Object.freeze({
    ensureIndexes: () => Friendship.syncIndexes(),

    /**
     * @param {FriendshipDoc} friendship  `low` must be the smaller id
     * @returns {Promise<FriendshipDoc>}
     * @throws {DuplicateKey} when the two are friends already
     */
    async insert(friendship) {
      try {
        await Friendship.create(friendship);
      } catch (err) {
        if (err.code === DUPLICATE_KEY_CODE) {
          throw new DuplicateKey(`${friendship.low} and ${friendship.high} are friends already`, {
            cause: err,
          });
        }
        throw err;
      }
      return Friendship.findOne({ low: friendship.low, high: friendship.high }, FIELDS).lean();
    },

    /**
     * @param {string} playerId
     * @returns {Promise<FriendshipDoc[]>} oldest first
     */
    listFor: (playerId) => Friendship.find(involving(playerId), FIELDS).sort({ createdAt: 1 }).lean(),

    /** @param {string} playerId @returns {Promise<number>} */
    countFor: (playerId) => Friendship.countDocuments(involving(playerId)),

    /** @param {{ low: string, high: string }} pair @returns {Promise<boolean>} */
    exists: async (pair) => (await Friendship.exists(pair)) !== null,

    /** @param {{ low: string, high: string }} pair @returns {Promise<number>} records deleted */
    async deletePair({ low, high }) {
      const { deletedCount } = await Friendship.deleteOne({ low, high });
      return deletedCount;
    },

    /** @param {string} playerId @returns {Promise<number>} records deleted on either side of the player */
    async deleteInvolving(playerId) {
      const { deletedCount } = await Friendship.deleteMany(involving(playerId));
      return deletedCount;
    },
  });
}
