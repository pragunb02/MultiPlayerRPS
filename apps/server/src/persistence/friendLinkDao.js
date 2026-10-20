import mongoose from "mongoose";
import { DuplicateKey } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;

/**
 * @typedef {Object} FriendLinkDoc   persistence object: a "be my friend" link a player made (CC-052)
 * @property {string} tokenHash       SHA-256 of the link's token in hex. The token itself is never stored
 * @property {string} creatorId       the player who made the link
 * @property {Date} createdAt
 * @property {Date} expiresAt         when it stops working. MongoDB removes it soon after
 */

const linkSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true },
    creatorId: { type: String, required: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: "friend_links", versionKey: false },
);
linkSchema.index({ tokenHash: 1 }, { unique: true });
// The links one player made, to keep only their newest few and to erase them.
linkSchema.index({ creatorId: 1, createdAt: -1 });
// MongoDB deletes a link soon after it stops working. Reads also skip one that stopped a moment ago.
linkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const FIELDS = "-_id tokenHash creatorId createdAt expiresAt";
const live = (now) => ({ expiresAt: { $gt: now } });
const gone = () => new RangeError("No such friend link, or it stopped working");

/**
 * Friend links in MongoDB (CC-052, ADR-066). A new collection: nothing existing is read or changed.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createFriendLinkDao({ connection }) {
  const Link = connection.model("FriendLink", linkSchema);

  return Object.freeze({
    ensureIndexes: () => Link.syncIndexes(),

    /**
     * @param {FriendLinkDoc} link
     * @returns {Promise<FriendLinkDoc>}
     * @throws {DuplicateKey} when a link has that token already
     */
    async insert(link) {
      try {
        await Link.create(link);
      } catch (err) {
        if (err.code === DUPLICATE_KEY_CODE) throw new DuplicateKey("That token is taken", { cause: err });
        throw err;
      }
      return Link.findOne({ tokenHash: link.tokenHash }, FIELDS).lean();
    },

    /**
     * @param {{ tokenHash: string, now: Date }} query
     * @returns {Promise<FriendLinkDoc>}
     * @throws {RangeError} when there is none, or it stopped working
     */
    async getLive({ tokenHash, now }) {
      const doc = await Link.findOne({ tokenHash, ...live(now) }, FIELDS).lean();
      if (doc === null) throw gone();
      return doc;
    },

    /**
     * Takes the link out in one step and answers it, so two presses at once cannot both use it.
     *
     * @param {{ tokenHash: string, now: Date }} query
     * @returns {Promise<FriendLinkDoc>}
     * @throws {RangeError} when there is none, or it stopped working
     */
    async take({ tokenHash, now }) {
      const doc = await Link.findOneAndDelete({ tokenHash, ...live(now) })
        .select(FIELDS)
        .lean();
      if (doc === null) throw gone();
      return doc;
    },

    /**
     * @param {{ creatorId: string, now: Date }} query
     * @returns {Promise<FriendLinkDoc[]>} the links the player made that still work, newest first
     */
    listBy: ({ creatorId, now }) =>
      Link.find({ creatorId, ...live(now) }, FIELDS)
        .sort({ createdAt: -1 })
        .lean(),

    /**
     * Deletes the player's oldest links beyond the newest `keep`.
     *
     * @param {{ creatorId: string, keep: number }} input
     * @returns {Promise<number>} links deleted
     */
    async keepNewest({ creatorId, keep }) {
      const older = await Link.find({ creatorId }, "-_id tokenHash")
        .sort({ createdAt: -1 })
        .skip(keep)
        .lean();
      if (older.length === 0) return 0;
      const { deletedCount } = await Link.deleteMany({
        tokenHash: { $in: older.map((doc) => doc.tokenHash) },
      });
      return deletedCount;
    },

    /** @param {string} creatorId @returns {Promise<number>} links deleted */
    async deleteBy(creatorId) {
      const { deletedCount } = await Link.deleteMany({ creatorId });
      return deletedCount;
    },
  });
}
