import { REPORT_STATUS } from "@classicade/shared";
import { DuplicateKey } from "../persistence/errors.js";
import { assertDefined } from "../utils/assert.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * @typedef {Readonly<{ by: string, kind: string, text: string, at: number }>} RecentEntry
 * @typedef {Readonly<{ kind: string, gameId?: string, roomCode?: string, matchId?: string, recent?: ReadonlyArray<RecentEntry> }>} ReportContext
 * @typedef {Object} Report         domain model (frozen, times in ms): one player reported another (CC-044, ADR-071)
 * @property {string} reportId
 * @property {string} reporterId
 * @property {string} reportedId     never sent to a client
 * @property {string} reportedName
 * @property {string} reason
 * @property {ReportContext} context
 * @property {string} day
 * @property {boolean} setAside
 * @property {string} status
 * @property {string} [action]
 * @property {number} createdAt
 * @property {number} [closedAt]
 */

const toContext = ({ recent, ...context }) =>
  Object.freeze({
    ...context,
    ...(recent !== undefined && {
      recent: Object.freeze(recent.map((entry) => Object.freeze({ ...entry, at: entry.at.getTime() }))),
    }),
  });

/** @returns {Readonly<Report>} */
const toReport = ({ createdAt, closedAt, context, ...doc }) =>
  Object.freeze({
    ...doc,
    context: toContext(context),
    createdAt: createdAt.getTime(),
    ...(closedAt !== undefined && { closedAt: closedAt.getTime() }),
  });
const toReports = (docs) => Object.freeze(docs.map(toReport));

const toContextDoc = ({ recent, ...context }) => ({
  ...context,
  ...(recent !== undefined && { recent: recent.map((entry) => ({ ...entry, at: new Date(entry.at) })) }),
});

/**
 * Provides player reports to the domain (CC-044, ADR-071).
 *
 * @param {{ reportDao: ReturnType<typeof import("../persistence/reportDao.js").createReportDao> }} deps
 */
export function createReportAccessor({ reportDao }) {
  assertDefined(reportDao, "reportDao");

  return Object.freeze({
    /**
     * Stores a new report as open, or answers the one the reporter already made on that player that day.
     *
     * @param {Omit<Report, "status" | "action" | "createdAt" | "closedAt"> & { at: number }} report
     * @returns {Promise<{ created: boolean, report: Readonly<Report> }>}
     */
    async add({ at, context, ...fields }) {
      try {
        const doc = await reportDao.insert({
          ...fields,
          context: toContextDoc(context),
          status: REPORT_STATUS.OPEN,
          createdAt: new Date(at),
        });
        return { created: true, report: toReport(doc) };
      } catch (err) {
        if (!(err instanceof DuplicateKey)) throw err;
        const { reporterId, reportedId, day } = fields;
        return {
          created: false,
          report: toReport(await reportDao.getByPairDay({ reporterId, reportedId, day })),
        };
      }
    },

    /**
     * @param {string} reportId
     * @returns {Promise<Readonly<Report>>}
     * @throws {NotFoundError} when there is no such report
     */
    async get(reportId) {
      try {
        return toReport(await reportDao.getById(reportId));
      } catch (err) {
        throw err instanceof RangeError ? new NotFoundError("No such report", { cause: err }) : err;
      }
    },

    /**
     * The reports of one status grouped by reported player, the most reporters first, one page (see the DAO).
     *
     * @param {{ status: string, skip: number, limit: number }} query
     * @returns {Promise<Readonly<{ total: number, groups: ReadonlyArray<Readonly<{ reportedId: string, reports: number, reporters: number, setAside: number, lastAt: number, newestId: string }>> }>>}
     */
    async listGroups(query) {
      const { total, groups } = await reportDao.listGroups(query);
      return Object.freeze({
        total,
        groups: Object.freeze(
          groups.map(({ lastAt, ...group }) => Object.freeze({ ...group, lastAt: lastAt.getTime() })),
        ),
      });
    },

    /** @param {string} reporterId @returns {Promise<ReadonlyArray<Readonly<Report>>>} newest first */
    listByReporter: async (reporterId) => toReports(await reportDao.listByReporter(reporterId)),

    /**
     * @param {{ reportedId: string, status: string, limit: number }} query
     * @returns {Promise<ReadonlyArray<Readonly<Report>>>} newest first
     */
    listAbout: async (query) => toReports(await reportDao.listAbout(query)),

    /**
     * Closes the open reports about a player up to `upTo`, the newest one the owner saw.
     *
     * @param {{ reportedId: string, upTo: { createdAt: number, reportId: string }, status: string, action: string, at: number }} change
     * @returns {Promise<number>} reports closed
     */
    closeOpen: ({ at, upTo, ...change }) =>
      reportDao.closeOpen({
        ...change,
        upTo: { createdAt: new Date(upTo.createdAt), reportId: upTo.reportId },
        closedAt: new Date(at),
      }),

    /** @param {{ from: string, to: string }} transfer @returns {Promise<number>} */
    moveReporter: (transfer) => reportDao.moveReporter(transfer),

    /** @param {{ from: string, to: string }} transfer @returns {Promise<number>} */
    moveReported: (transfer) => reportDao.moveReported(transfer),

    /** @param {{ reporterId: string, standIn: () => string }} input @returns {Promise<number>} */
    anonymiseReporter: (input) => reportDao.anonymiseReporter(input),

    /** @param {string} reportedId @returns {Promise<number>} */
    removeAbout: (reportedId) => reportDao.deleteAbout(reportedId),
  });
}
