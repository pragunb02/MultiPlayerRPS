import { FEEDBACK_STATUSES } from "@classicade/shared";
import { assertDefined } from "../utils/assert.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * @typedef {Object} Feedback       domain model (frozen, times in ms): one item of in-app feedback (CC-290)
 * @property {string} feedbackId
 * @property {string} type
 * @property {string} message
 * @property {string} [replyEmail]
 * @property {string} page
 * @property {string} build
 * @property {string} device
 * @property {string} kind
 * @property {string} status
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/** @returns {Readonly<Feedback>} */
const toFeedback = ({ createdAt, updatedAt, ...doc }) =>
  Object.freeze({ ...doc, createdAt: createdAt.getTime(), updatedAt: updatedAt.getTime() });
const toList = (docs) => Object.freeze(docs.map(toFeedback));

/**
 * Provides in-app feedback to the domain (CC-290, ADR-059).
 *
 * @param {{ feedbackDao: ReturnType<typeof import("../persistence/feedbackDao.js").createFeedbackDao> }} deps
 */
export function createFeedbackAccessor({ feedbackDao }) {
  assertDefined(feedbackDao, "feedbackDao");

  return Object.freeze({
    /**
     * Stores a new item. Every item starts as the first status, "new".
     *
     * @param {Omit<Feedback, "status" | "createdAt" | "updatedAt"> & { at: number }} item
     * @returns {Promise<Readonly<Feedback>>}
     */
    async add({ at, ...fields }) {
      const when = new Date(at);
      return toFeedback(
        await feedbackDao.insert({
          ...fields,
          status: FEEDBACK_STATUSES[0],
          createdAt: when,
          updatedAt: when,
        }),
      );
    },

    /**
     * @param {{ where: { type?: string, status?: string }, limit: number, before?: { createdAt: number, feedbackId: string } }} query
     *   `before` is the last item of the page shown before
     * @returns {Promise<ReadonlyArray<Readonly<Feedback>>>} newest first
     */
    list: async ({ where, limit, before }) =>
      toList(
        await feedbackDao.list({
          where,
          limit,
          ...(before !== undefined && {
            before: { createdAt: new Date(before.createdAt), feedbackId: before.feedbackId },
          }),
        }),
      ),

    /**
     * @param {string} feedbackId
     * @returns {Promise<Readonly<Feedback>>}
     * @throws {NotFoundError} when there is no such item
     */
    async get(feedbackId) {
      try {
        return toFeedback(await feedbackDao.getById(feedbackId));
      } catch (err) {
        if (err instanceof RangeError) throw new NotFoundError("No such feedback", { cause: err });
        throw err;
      }
    },

    /** @param {string} feedbackId @returns {Promise<boolean>} whether it was there to delete */
    remove: async (feedbackId) => (await feedbackDao.deleteById(feedbackId)) > 0,

    /**
     * @param {{ feedbackId: string, status: string, at: number }} change
     * @returns {Promise<Readonly<Feedback>>}
     * @throws {NotFoundError} when there is no such item
     */
    async setStatus({ feedbackId, status, at }) {
      try {
        return toFeedback(await feedbackDao.setStatus({ feedbackId, status, updatedAt: new Date(at) }));
      } catch (err) {
        if (err instanceof RangeError) throw new NotFoundError("No such feedback", { cause: err });
        throw err;
      }
    },
  });
}
