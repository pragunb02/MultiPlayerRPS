import { DuplicateKey } from "../persistence/errors.js";
import { assertDefined } from "../utils/assert.js";

/**
 * @typedef {Object} Block        domain model (frozen, times in ms): one player blocked another (CC-044)
 * @property {string} blockId      random id of the record, the only id a client ever sees
 * @property {string} blockerId
 * @property {string} blockedId
 * @property {string} blockedName  the blocked player's display name when they were blocked
 * @property {number} createdAt
 */

/** @returns {Readonly<Block>} */
const toBlock = ({ createdAt, ...doc }) => Object.freeze({ ...doc, createdAt: createdAt.getTime() });
const toBlocks = (docs) => Object.freeze(docs.map(toBlock));

/**
 * Provides player blocks to the domain (CC-044, ADR-053).
 *
 * @param {{ blockDao: ReturnType<typeof import("../persistence/blockDao.js").createBlockDao> }} deps
 */
export function createBlockAccessor({ blockDao }) {
  assertDefined(blockDao, "blockDao");

  return Object.freeze({
    /**
     * Stores a block, or answers the one the blocker already has on that player.
     *
     * @param {{ blockId: string, blockerId: string, blockedId: string, blockedName: string, at: number }} block
     * @returns {Promise<{ created: boolean, block: Readonly<Block> }>}
     */
    async add({ blockId, blockerId, blockedId, blockedName, at }) {
      try {
        const doc = await blockDao.insert({
          blockId,
          blockerId,
          blockedId,
          blockedName,
          createdAt: new Date(at),
        });
        return { created: true, block: toBlock(doc) };
      } catch (err) {
        if (!(err instanceof DuplicateKey)) throw err;
        return { created: false, block: toBlock(await blockDao.getByPair({ blockerId, blockedId })) };
      }
    },

    /** @param {string} blockerId @returns {Promise<ReadonlyArray<Readonly<Block>>>} newest first */
    listBy: async (blockerId) => toBlocks(await blockDao.listByBlocker(blockerId)),

    /** @param {string} playerId @returns {Promise<ReadonlyArray<Readonly<Block>>>} on either side of the player */
    listInvolving: async (playerId) => toBlocks(await blockDao.listInvolving(playerId)),

    /** @param {{ blockerId: string, blockId: string }} own @returns {Promise<boolean>} whether it was removed */
    remove: async (own) => (await blockDao.deleteOwn(own)) > 0,

    /** @param {{ blockerId: string, keep: number }} input @returns {Promise<number>} oldest blocks removed */
    keepNewest: (input) => blockDao.keepNewest(input),

    /** @param {{ from: string, to: string }} transfer @returns {Promise<number>} blocks the player made, moved */
    moveBlocker: (transfer) => blockDao.moveBlocker(transfer),

    /** @param {{ from: string, to: string }} transfer @returns {Promise<number>} blocks on the player, moved */
    moveBlocked: (transfer) => blockDao.moveBlocked(transfer),

    /** @param {string} playerId @returns {Promise<number>} blocks removed on either side of the player */
    removeInvolving: (playerId) => blockDao.deleteInvolving(playerId),
  });
}
