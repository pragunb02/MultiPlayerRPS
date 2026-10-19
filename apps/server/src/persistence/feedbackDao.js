import mongoose from "mongoose";
import { FEEDBACK_KEEP_DAYS } from "@classicade/shared";

const DAY_SECONDS = 24 * 60 * 60;

/**
 * @typedef {Object} FeedbackDoc    persistence object: one item of in-app feedback (CC-290, ADR-059)
 * @property {string} feedbackId     random id, the only id any client sees
 * @property {string} type           one of FEEDBACK_TYPES
 * @property {string} message        plain text as the player typed it
 * @property {string} [replyEmail]   only when an adult asked for a reply
 * @property {string} page           the route pattern, never a room code or a name
 * @property {string} build          the web build that sent it
 * @property {string} device         one of FEEDBACK_DEVICES
 * @property {string} kind           one of FEEDBACK_KINDS
 * @property {string} status         one of FEEDBACK_STATUSES
 * @property {Date} createdAt        MongoDB removes the item FEEDBACK_KEEP_DAYS after this
 * @property {Date} updatedAt        when the status last changed, or createdAt
 */

/**
 * @typedef {{ type?: string, status?: string }} FeedbackWhere   the filters, each one only when given
 * @typedef {{ createdAt: Date, feedbackId: string }} FeedbackCursor   the last item of the page before
 */

const feedbackSchema = new mongoose.Schema(
  {
    feedbackId: { type: String, required: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    replyEmail: { type: String },
    page: { type: String, required: true },
    build: { type: String, required: true },
    device: { type: String, required: true },
    kind: { type: String, required: true },
    status: { type: String, required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: "feedback", versionKey: false },
);
feedbackSchema.index({ feedbackId: 1 }, { unique: true });
// MongoDB deletes an item once it is older than the period, checked about once a minute.
feedbackSchema.index({ createdAt: 1 }, { expireAfterSeconds: FEEDBACK_KEEP_DAYS * DAY_SECONDS });
// The inbox reads newest first, and pages on to older items by the last one shown.
feedbackSchema.index({ createdAt: -1, feedbackId: -1 });

const FIELDS = "-_id feedbackId type message replyEmail page build device kind status createdAt updatedAt";
const NEWEST_FIRST = Object.freeze({ createdAt: -1, feedbackId: -1 });

/** The query for items older than the cursor. Two items sent in the same millisecond are told apart by id. */
const olderThan = ({ createdAt, feedbackId }) => ({
  $or: [{ createdAt: { $lt: createdAt } }, { createdAt, feedbackId: { $lt: feedbackId } }],
});

/**
 * In-app feedback in MongoDB (CC-290, ADR-059). A collection of its own, which nothing else reads or writes.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createFeedbackDao({ connection }) {
  const Feedback = connection.model("Feedback", feedbackSchema);

  return Object.freeze({
    ensureIndexes: () => Feedback.syncIndexes(),

    /**
     * @param {FeedbackDoc} item
     * @returns {Promise<FeedbackDoc>}
     */
    async insert(item) {
      await Feedback.create(item);
      return Feedback.findOne({ feedbackId: item.feedbackId }, FIELDS).lean();
    },

    /**
     * @param {{ where: FeedbackWhere, before?: FeedbackCursor, limit: number }} query
     * @returns {Promise<FeedbackDoc[]>} newest first
     */
    list: ({ where, before, limit }) =>
      Feedback.find({ ...where, ...(before !== undefined && olderThan(before)) }, FIELDS)
        .sort(NEWEST_FIRST)
        .limit(limit)
        .lean(),

    /**
     * @param {string} feedbackId
     * @returns {Promise<FeedbackDoc>}
     * @throws {RangeError} when there is no such item
     */
    async getById(feedbackId) {
      const doc = await Feedback.findOne({ feedbackId }, FIELDS).lean();
      if (doc === null) {
        throw new RangeError(`No feedback ${feedbackId}`);
      }
      return doc;
    },

    /**
     * @param {string} feedbackId
     * @returns {Promise<number>} items deleted: 0 when it was not there
     */
    async deleteById(feedbackId) {
      const { deletedCount } = await Feedback.deleteOne({ feedbackId });
      return deletedCount;
    },

    /**
     * @param {{ feedbackId: string, status: string, updatedAt: Date }} change
     * @returns {Promise<FeedbackDoc>} the item after the change
     * @throws {RangeError} when there is no such item
     */
    async setStatus({ feedbackId, status, updatedAt }) {
      const doc = await Feedback.findOneAndUpdate(
        { feedbackId },
        { $set: { status, updatedAt } },
        { returnDocument: "after" },
      )
        .select(FIELDS)
        .lean();
      if (doc === null) {
        throw new RangeError(`No feedback ${feedbackId}`);
      }
      return doc;
    },
  });
}
