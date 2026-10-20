import { DuplicateKey } from "../persistence/errors.js";
import { assertDefined } from "../utils/assert.js";

/**
 * @typedef {Object} PlayerTransfer       domain model (frozen; times in ms): a guest's data moving to an account
 * @property {string} from                  guest player id
 * @property {Readonly<import("../models/identity.js").Identity>} to
 * @property {"pending" | "done"} status
 * @property {number} createdAt
 * @property {number} [completedAt]
 * @property {Readonly<{ xp: number, matchesPlayed: number, matches: number }>} [carriedOver]
 */

/** @returns {Readonly<PlayerTransfer>} */
const toTransfer = ({ createdAt, completedAt, carriedOver, to, ...doc }) =>
  Object.freeze({
    ...doc,
    to: Object.freeze({ ...to }),
    createdAt: createdAt.getTime(),
    ...(completedAt !== undefined && { completedAt: completedAt.getTime() }),
    ...(carriedOver !== undefined && { carriedOver: Object.freeze({ ...carriedOver }) }),
  });

/**
 * Provides guest → account transfer records to the domain (CC-032).
 *
 * @param {{ playerTransferDao: ReturnType<typeof import("../persistence/playerTransferDao.js").createPlayerTransferDao> }} deps
 */
export function createPlayerTransferAccessor({ playerTransferDao }) {
  assertDefined(playerTransferDao, "playerTransferDao");

  return Object.freeze({
    /**
     * Starts a transfer, or returns the one this guest already has (a guest moves once).
     *
     * @param {{ from: string, to: Readonly<import("../models/identity.js").Identity>, at: number }} start
     * @returns {Promise<{ created: boolean, transfer: Readonly<PlayerTransfer> }>}
     */
    async start({ from, to, at }) {
      try {
        const doc = await playerTransferDao.insertPending({ from, to: { ...to }, createdAt: new Date(at) });
        return { created: true, transfer: toTransfer(doc) };
      } catch (err) {
        if (err instanceof DuplicateKey) {
          return { created: false, transfer: toTransfer(await playerTransferDao.getByFrom(from)) };
        }
        throw err;
      }
    },

    /**
     * @param {{ from: string, at: number, carriedOver: NonNullable<PlayerTransfer["carriedOver"]> }} done
     */
    async markDone({ from, at, carriedOver }) {
      await playerTransferDao.markDone({ from, completedAt: new Date(at), carriedOver: { ...carriedOver } });
    },

    /**
     * @param {{ createdBefore: number, limit: number }} query
     * @returns {Promise<ReadonlyArray<Readonly<PlayerTransfer>>>} oldest first
     */
    async listPending({ createdBefore, limit }) {
      const docs = await playerTransferDao.listPending({ createdBefore: new Date(createdBefore), limit });
      return Object.freeze(docs.map(toTransfer));
    },

    /**
     * @param {ReadonlyArray<string>} playerIds
     * @returns {Promise<ReadonlyArray<Readonly<PlayerTransfer>>>} the transfers of those who have one
     */
    async listFrom(playerIds) {
      return Object.freeze((await playerTransferDao.listByFrom([...playerIds])).map(toTransfer));
    },

    /**
     * The transfers into any of these accounts that are not done yet (CC-291).
     *
     * @param {ReadonlyArray<string>} playerIds  account player ids
     * @returns {Promise<ReadonlyArray<Readonly<PlayerTransfer>>>}
     */
    async listPendingTo(playerIds) {
      return Object.freeze((await playerTransferDao.listPendingTo([...playerIds])).map(toTransfer));
    },

    /**
     * The transfers into one account, oldest first (CC-035).
     *
     * @param {string} playerId  the account's player id
     * @returns {Promise<ReadonlyArray<Readonly<PlayerTransfer>>>}
     */
    async listTo(playerId) {
      return Object.freeze((await playerTransferDao.listByTo(playerId)).map(toTransfer));
    },

    /** @param {string} playerId  the account's player id @returns {Promise<number>} transfers removed (CC-035) */
    removeTo: (playerId) => playerTransferDao.deleteByTo(playerId),
  });
}
