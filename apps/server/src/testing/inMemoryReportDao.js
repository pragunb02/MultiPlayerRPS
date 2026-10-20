import { DuplicateKey } from "../persistence/errors.js";

/** Test double with the same contract as `createReportDao` (verified by the shared contract tests). */
export function createInMemoryReportDao() {
  /** @type {Map<string, object>} reports by report id */
  const reports = new Map();
  const copy = (doc) => structuredClone(doc);
  const newestFirst = (a, b) =>
    b.createdAt - a.createdAt || (a.reportId < b.reportId ? 1 : a.reportId > b.reportId ? -1 : 0);
  const find = (test) => [...reports.values()].filter(test).sort(newestFirst);
  const samePairDay = (doc, { reporterId, reportedId, day }) =>
    doc.reporterId === reporterId && doc.reportedId === reportedId && doc.day === day;

  function getById(reportId) {
    const doc = reports.get(reportId);
    if (doc === undefined) {
      throw new RangeError(`No report ${reportId}`);
    }
    return copy(doc);
  }

  function move(field, other, { from, to }) {
    let moved = 0;
    for (const doc of find((d) => d[field] === from)) {
      const next = { ...doc, [field]: to };
      const repeated = doc[other] === to || find((d) => samePairDay(d, next)).length > 0;
      if (repeated) {
        reports.delete(doc.reportId);
        continue;
      }
      reports.set(doc.reportId, next);
      moved += 1;
    }
    return moved;
  }

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert(report) {
      if (reports.has(report.reportId) || find((d) => samePairDay(d, report)).length > 0) {
        throw new DuplicateKey(`${report.reporterId} already reported ${report.reportedId} on ${report.day}`);
      }
      reports.set(report.reportId, copy(report));
      return copy(report);
    },

    getById: async (reportId) => getById(reportId),

    async getByPairDay(pair) {
      const [doc] = find((d) => samePairDay(d, pair));
      if (doc === undefined) {
        throw new RangeError(`${pair.reporterId} did not report ${pair.reportedId} on ${pair.day}`);
      }
      return copy(doc);
    },

    listByStatus: async ({ status, limit }) =>
      find((d) => d.status === status)
        .slice(0, limit)
        .map(copy),

    listByReporter: async (reporterId) => find((d) => d.reporterId === reporterId).map(copy),

    listOpenAbout: async (reportedId) =>
      find((d) => d.reportedId === reportedId && d.status === "open").map(copy),

    async closeOpen({ reportedId, status, action, closedAt }) {
      const open = find((d) => d.reportedId === reportedId && d.status === "open");
      open.forEach((doc) => reports.set(doc.reportId, { ...doc, status, action, closedAt }));
      return open.length;
    },

    moveReporter: async (transfer) => move("reporterId", "reportedId", transfer),

    moveReported: async (transfer) => move("reportedId", "reporterId", transfer),

    async anonymiseReporter({ reporterId, standIn }) {
      const made = find((d) => d.reporterId === reporterId);
      for (const doc of made) {
        const { note, ...rest } = doc;
        reports.set(doc.reportId, { ...rest, reporterId: standIn() });
      }
      return made.length;
    },

    async deleteAbout(reportedId) {
      const about = find((d) => d.reportedId === reportedId);
      about.forEach((doc) => reports.delete(doc.reportId));
      return about.length;
    },
  });
}
