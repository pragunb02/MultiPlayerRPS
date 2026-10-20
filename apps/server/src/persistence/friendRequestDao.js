import mongoose from "mongoose";
import { DuplicateKey } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;

/**
 * @typedef {Object} FriendRequestDoc   persistence object: one player asked another to be friends (CC-052)
 * @property {string} requestId          random id, the only id of a request a client ever sees
 * @property {string} senderId
 * @property {string} recipientId
 * @property {string} via                "game" or "link", how the request came about
 * @property {string} status             "pending", "declined" or "withdrawn"
 * @property {Date} createdAt            when it was last sent
 * @property {Date} notifiedAt           when the recipient was last told about it
 * @property {Date} expiresAt            when it runs out. MongoDB removes it soon after
 */

const requestSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true },
    senderId: { type: String, required: true },
    recipientId: { type: String, required: true },
    via: { type: String, required: true },
    status: { type: String, required: true },
    createdAt: { type: Date, required: true },
    notifiedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: "friend_requests", versionKey: false },
);
// One request per sender and recipient. It also serves the sender's own list.
requestSchema.index({ senderId: 1, recipientId: 1 }, { unique: true });
// The requests waiting for a player.
requestSchema.index({ recipientId: 1, createdAt: -1 });
requestSchema.index({ requestId: 1 }, { unique: true });
// MongoDB deletes a request soon after it runs out. Reads also skip one that ran out a moment ago.
requestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const FIELDS = "-_id requestId senderId recipientId via status createdAt notifiedAt expiresAt";
const live = (now) => ({ expiresAt: { $gt: now } });

/**
 * Friend requests in MongoDB (CC-052, ADR-066). A new collection: nothing existing is read or changed.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createFriendRequestDao({ connection }) {
  const Request = connection.model("FriendRequest", requestSchema);

  /** @param {object} filter @throws {RangeError} */
  async function getOne(filter, what) {
    const doc = await Request.findOne(filter, FIELDS).lean();
    if (doc === null) {
      throw new RangeError(`No friend request ${what}`);
    }
    return doc;
  }

  return Object.freeze({
    ensureIndexes: () => Request.syncIndexes(),

    /**
     * @param {FriendRequestDoc} request
     * @returns {Promise<FriendRequestDoc>}
     * @throws {DuplicateKey} when the sender has a request to that player already, running out or not
     */
    async insert(request) {
      try {
        await Request.create(request);
      } catch (err) {
        if (err.code === DUPLICATE_KEY_CODE) {
          throw new DuplicateKey(`${request.senderId} asked ${request.recipientId} already`, { cause: err });
        }
        throw err;
      }
      return getOne({ requestId: request.requestId }, request.requestId);
    },

    /**
     * Every request from one player to the other, even one that ran out and is not deleted yet.
     *
     * @param {{ senderId: string, recipientId: string }} pair
     * @returns {Promise<FriendRequestDoc>}
     * @throws {RangeError} when there is none
     */
    getByPair: ({ senderId, recipientId }) =>
      getOne({ senderId, recipientId }, `from ${senderId} to ${recipientId}`),

    /**
     * @param {{ requestId: string, now: Date }} query
     * @returns {Promise<FriendRequestDoc>}
     * @throws {RangeError} when there is none, or it ran out
     */
    getLive: ({ requestId, now }) => getOne({ requestId, ...live(now) }, requestId),

    /**
     * Changes a request only while it has one of the given statuses, so two answers at once cannot both win.
     *
     * @param {{ requestId: string, statuses: ReadonlyArray<string>, set: Partial<FriendRequestDoc> }} change
     * @returns {Promise<number>} requests changed: 0 when it had none of the statuses or is gone
     */
    async update({ requestId, statuses, set }) {
      const { modifiedCount } = await Request.updateOne(
        { requestId, status: { $in: [...statuses] } },
        { $set: set },
      );
      return modifiedCount;
    },

    /**
     * @param {{ senderId: string, statuses: ReadonlyArray<string>, now: Date }} query
     * @returns {Promise<FriendRequestDoc[]>} the requests the player sent that have not run out, newest first
     */
    listSentBy: ({ senderId, statuses, now }) =>
      Request.find({ senderId, status: { $in: [...statuses] }, ...live(now) }, FIELDS)
        .sort({ createdAt: -1 })
        .lean(),

    /**
     * @param {{ recipientId: string, statuses: ReadonlyArray<string>, now: Date, limit: number }} query
     * @returns {Promise<FriendRequestDoc[]>} the requests sent to the player that have not run out, newest first
     */
    listSentTo: ({ recipientId, statuses, now, limit }) =>
      Request.find({ recipientId, status: { $in: [...statuses] }, ...live(now) }, FIELDS)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),

    /** @param {{ a: string, b: string }} pair @returns {Promise<number>} requests deleted, either way */
    async deleteBetween({ a, b }) {
      const { deletedCount } = await Request.deleteMany({
        $or: [
          { senderId: a, recipientId: b },
          { senderId: b, recipientId: a },
        ],
      });
      return deletedCount;
    },

    /** @param {string} playerId @returns {Promise<number>} requests deleted, sent or received */
    async deleteInvolving(playerId) {
      const { deletedCount } = await Request.deleteMany({
        $or: [{ senderId: playerId }, { recipientId: playerId }],
      });
      return deletedCount;
    },
  });
}
