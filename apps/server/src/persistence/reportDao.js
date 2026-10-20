import mongoose from "mongoose";
import { REPORT_KEEP_DAYS } from "@classicade/shared";
import { DuplicateKey } from "./errors.js";

const DAY_SECONDS = 24 * 60 * 60;
const DUPLICATE_KEY_CODE = 11000;

/**
 * @typedef {Object} RecentEntry    one thing that happened between the pair before the report, players named by role
 * @property {string} by             "reported", "reporter" or "other"
 * @property {string} kind           "move" or "request"
 * @property {string} text           the move as JSON, or the request's type and state
 * @property {Date} at
 *
 * @typedef {Object} ReportContext   where the report was made, snapshotted when it was made
 * @property {string} kind           one of REPORT_CONTEXT
 * @property {string} [gameId]
 * @property {string} [roomCode]
 * @property {string} [matchId]
 * @property {RecentEntry[]} [recent]
 *
 * @typedef {Object} ReportDoc      persistence object: one player reported another (CC-044, ADR-071)
 * @property {string} reportId       random id, the only id the reporter and the console see
 * @property {string} reporterId     who reported, or a `deleted_` stand-in once they deleted their account
 * @property {string} reportedId     who was reported. Never sent to any client
 * @property {string} reportedName   the reported player's display name when the report was made
 * @property {string} reason         one of REPORT_REASONS
 * @property {string} [note]         plain text, contacts masked, only when the reporter wrote one
 * @property {ReportContext} context
 * @property {string} day            the India day of the report: one report per reporter and player a day
 * @property {boolean} setAside      made by a reporter whose reports were dismissed before (ADR-071.5)
 * @property {string} status         one of REPORT_STATUSES
 * @property {string} [action]       one of REPORT_ACTIONS, once closed
 * @property {Date} createdAt        MongoDB removes the report REPORT_KEEP_DAYS after this
 * @property {Date} [closedAt]
 */

const recentSchema = new mongoose.Schema(
  {
    by: { type: String, required: true },
    kind: { type: String, required: true },
    text: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const contextSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true },
    gameId: { type: String },
    roomCode: { type: String },
    matchId: { type: String },
    recent: { type: [recentSchema], default: undefined },
  },
  { _id: false },
);

const reportSchema = new mongoose.Schema(
  {
    reportId: { type: String, required: true },
    reporterId: { type: String, required: true },
    reportedId: { type: String, required: true },
    reportedName: { type: String, required: true },
    reason: { type: String, required: true },
    note: { type: String },
    context: { type: contextSchema, required: true },
    day: { type: String, required: true },
    setAside: { type: Boolean, required: true },
    status: { type: String, required: true },
    action: { type: String },
    createdAt: { type: Date, required: true },
    closedAt: { type: Date },
  },
  { collection: "player_reports", versionKey: false },
);
reportSchema.index({ reportId: 1 }, { unique: true });
// One report per reporter and player a day. It also serves the reporter's own list and export, which start with
// `reporterId`.
reportSchema.index({ reporterId: 1, reportedId: 1, day: 1 }, { unique: true });
// The open reports about one player, for the console's actions, and every report about them for deletion.
reportSchema.index({ reportedId: 1, status: 1 });
// The console's queue reads one status, newest first.
reportSchema.index({ status: 1, createdAt: -1 });
// MongoDB deletes a report once it is older than the period, checked about once a minute.
reportSchema.index({ createdAt: 1 }, { expireAfterSeconds: REPORT_KEEP_DAYS * DAY_SECONDS });

const FIELDS =
  "-_id reportId reporterId reportedId reportedName reason note context day setAside status action createdAt closedAt";
const NEWEST_FIRST = Object.freeze({ createdAt: -1, reportId: -1 });
const isDuplicate = (err) => err.code === DUPLICATE_KEY_CODE;

/**
 * Player reports in MongoDB (CC-044, ADR-071). A collection of its own, which nothing else reads or writes.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createReportDao({ connection }) {
  const Report = connection.model("PlayerReport", reportSchema);

  /** @returns {Promise<ReportDoc>} */
  async function getById(reportId) {
    const doc = await Report.findOne({ reportId }, FIELDS).lean();
    if (doc === null) {
      throw new RangeError(`No report ${reportId}`);
    }
    return doc;
  }

  /**
   * Gives every report that names `from` in `field` to `to` instead. One that would then name `to` on both sides, or
   * repeat a day's pair `to` already has, is deleted. Answers how many moved.
   */
  async function move(field, other, { from, to }) {
    let moved = 0;
    for (const doc of await Report.find({ [field]: from }, FIELDS).lean()) {
      const repeated =
        doc[other] === to ||
        (await Report.exists({ [field]: to, [other]: doc[other], day: doc.day })) !== null;
      if (repeated) {
        await Report.deleteOne({ reportId: doc.reportId });
        continue;
      }
      // Two moves at the same moment can still meet the unique index here. The move then fails, and the guest
      // transfer runs it again later (ADR-014), when the check above sees the pair.
      await Report.updateOne({ reportId: doc.reportId }, { $set: { [field]: to } });
      moved += 1;
    }
    return moved;
  }

  return Object.freeze({
    ensureIndexes: () => Report.syncIndexes(),

    /**
     * @param {ReportDoc} report
     * @returns {Promise<ReportDoc>}
     * @throws {DuplicateKey} when the reporter already reported that player that day
     */
    async insert(report) {
      try {
        await Report.create(report);
      } catch (err) {
        if (isDuplicate(err)) {
          throw new DuplicateKey(`${report.reporterId} already reported ${report.reportedId} on ${report.day}`, {
            cause: err,
          });
        }
        throw err;
      }
      return getById(report.reportId);
    },

    /**
     * @param {string} reportId
     * @returns {Promise<ReportDoc>}
     * @throws {RangeError} when there is no such report
     */
    getById,

    /**
     * @param {{ reporterId: string, reportedId: string, day: string }} pair
     * @returns {Promise<ReportDoc>}
     * @throws {RangeError} when there is none
     */
    async getByPairDay(pair) {
      const doc = await Report.findOne(pair, FIELDS).lean();
      if (doc === null) {
        throw new RangeError(`${pair.reporterId} did not report ${pair.reportedId} on ${pair.day}`);
      }
      return doc;
    },

    /**
     * @param {{ status: string, limit: number }} query
     * @returns {Promise<ReportDoc[]>} newest first
     */
    listByStatus: ({ status, limit }) => Report.find({ status }, FIELDS).sort(NEWEST_FIRST).limit(limit).lean(),

    /** @param {string} reporterId @returns {Promise<ReportDoc[]>} newest first */
    listByReporter: (reporterId) => Report.find({ reporterId }, FIELDS).sort(NEWEST_FIRST).lean(),

    /** @param {string} reportedId @returns {Promise<ReportDoc[]>} the open reports about the player, newest first */
    listOpenAbout: (reportedId) =>
      Report.find({ reportedId, status: "open" }, FIELDS).sort(NEWEST_FIRST).lean(),

    /**
     * @param {{ reportedId: string, status: string, action: string, closedAt: Date }} change
     * @returns {Promise<number>} reports closed
     */
    async closeOpen({ reportedId, status, action, closedAt }) {
      const { modifiedCount } = await Report.updateMany(
        { reportedId, status: "open" },
        { $set: { status, action, closedAt } },
      );
      return modifiedCount;
    },

    /** @param {{ from: string, to: string }} transfer @returns {Promise<number>} reports the player made, moved */
    moveReporter: (transfer) => move("reporterId", "reportedId", transfer),

    /** @param {{ from: string, to: string }} transfer @returns {Promise<number>} reports about the player, moved */
    moveReported: (transfer) => move("reportedId", "reporterId", transfer),

    /**
     * Gives each report the player made a stand-in of its own and drops its note, which holds their words.
     *
     * @param {{ reporterId: string, standIn: () => string }} input
     * @returns {Promise<number>} reports changed
     */
    async anonymiseReporter({ reporterId, standIn }) {
      const docs = await Report.find({ reporterId }, "-_id reportId").lean();
      for (const { reportId } of docs) {
        await Report.updateOne({ reportId }, { $set: { reporterId: standIn() }, $unset: { note: "" } });
      }
      return docs.length;
    },

    /** @param {string} reportedId @returns {Promise<number>} reports about the player, deleted */
    async deleteAbout(reportedId) {
      const { deletedCount } = await Report.deleteMany({ reportedId });
      return deletedCount;
    },
  });
}
