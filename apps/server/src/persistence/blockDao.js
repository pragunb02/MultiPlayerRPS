import mongoose from "mongoose";
import { DuplicateKey } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;

/**
 * @typedef {Object} BlockDoc     persistence object: one player blocked another (CC-044)
 * @property {string} blockId      random id of the record, the only id a client ever sees
 * @property {string} blockerId    the player who blocked
 * @property {string} blockedId    the player they blocked
 * @property {string} blockedName  the blocked player's display name when they were blocked
 * @property {Date} createdAt
 */

const blockSchema = new mongoose.Schema(
  {
    blockId: { type: String, required: true },
    blockerId: { type: String, required: true },
    blockedId: { type: String, required: true },
    blockedName: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: "player_blocks", versionKey: false },
);
// One block per pair. It also serves the blocker's own list, which starts with `blockerId`.
blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
// The other direction: "who blocked this player", for the rule that a block works both ways.
blockSchema.index({ blockedId: 1 });
blockSchema.index({ blockId: 1 }, { unique: true });

const FIELDS = "-_id blockId blockerId blockedId blockedName createdAt";
const isDuplicate = (err) => err.code === DUPLICATE_KEY_CODE;

/**
 * Player blocks in MongoDB (CC-044, ADR-053).
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createBlockDao({ connection }) {
  const Block = connection.model("PlayerBlock", blockSchema);

  /**
   * Gives every record that names `from` in `field` to `to` instead. A record that would then repeat a pair `to`
   * already has, or name `to` on both sides, is deleted. Answers how many records moved.
   */
  async function move(field, other, { from, to }) {
    let moved = 0;
    for (const doc of await Block.find({ [field]: from }, FIELDS).lean()) {
      const repeated =
        doc[other] === to || (await Block.exists({ [field]: to, [other]: doc[other] })) !== null;
      if (repeated) {
        await Block.deleteOne({ blockId: doc.blockId });
        continue;
      }
      // Two moves at the same moment can still meet the unique index here. The move then fails, and the guest
      // transfer runs it again later (ADR-014), when the check above sees the pair.
      await Block.updateOne({ blockId: doc.blockId }, { $set: { [field]: to } });
      moved += 1;
    }
    return moved;
  }

  return Object.freeze({
    ensureIndexes: () => Block.syncIndexes(),

    /**
     * @param {BlockDoc} block
     * @returns {Promise<BlockDoc>}
     * @throws {DuplicateKey} when the blocker already blocked that player
     */
    async insert(block) {
      try {
        await Block.create(block);
      } catch (err) {
        if (isDuplicate(err)) {
          throw new DuplicateKey(`${block.blockerId} already blocked ${block.blockedId}`, { cause: err });
        }
        throw err;
      }
      return this.getByPair(block);
    },

    /**
     * @param {{ blockerId: string, blockedId: string }} pair
     * @returns {Promise<BlockDoc>}
     * @throws {RangeError} when there is no such block
     */
    async getByPair({ blockerId, blockedId }) {
      const doc = await Block.findOne({ blockerId, blockedId }, FIELDS).lean();
      if (doc === null) {
        throw new RangeError(`${blockerId} has not blocked ${blockedId}`);
      }
      return doc;
    },

    /**
     * @param {string} blockerId
     * @returns {Promise<BlockDoc[]>} newest first
     */
    listByBlocker: (blockerId) => Block.find({ blockerId }, FIELDS).sort({ createdAt: -1 }).lean(),

    /**
     * @param {string} playerId
     * @returns {Promise<BlockDoc[]>} the blocks the player made and the blocks on them
     */
    listInvolving: (playerId) =>
      Block.find({ $or: [{ blockerId: playerId }, { blockedId: playerId }] }, FIELDS).lean(),

    /**
     * @param {{ blockerId: string, blockId: string }} own
     * @returns {Promise<number>} records deleted: 0 when the block is not the blocker's
     */
    async deleteOwn({ blockerId, blockId }) {
      const { deletedCount } = await Block.deleteOne({ blockerId, blockId });
      return deletedCount;
    },

    /**
     * Deletes the blocker's oldest blocks beyond the newest `keep`.
     *
     * @param {{ blockerId: string, keep: number }} input
     * @returns {Promise<number>} records deleted
     */
    async keepNewest({ blockerId, keep }) {
      const older = await Block.find({ blockerId }, "-_id blockId").sort({ createdAt: -1 }).skip(keep).lean();
      if (older.length === 0) return 0;
      const { deletedCount } = await Block.deleteMany({ blockId: { $in: older.map((doc) => doc.blockId) } });
      return deletedCount;
    },

    /** @param {{ from: string, to: string }} transfer @returns {Promise<number>} blocks moved */
    moveBlocker: (transfer) => move("blockerId", "blockedId", transfer),

    /** @param {{ from: string, to: string }} transfer @returns {Promise<number>} blocks moved */
    moveBlocked: (transfer) => move("blockedId", "blockerId", transfer),

    /**
     * @param {string} playerId
     * @returns {Promise<number>} records deleted on either side of the player
     */
    async deleteInvolving(playerId) {
      const { deletedCount } = await Block.deleteMany({
        $or: [{ blockerId: playerId }, { blockedId: playerId }],
      });
      return deletedCount;
    },
  });
}
