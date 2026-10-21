import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

/** How long MongoDB keeps a day's totals, in days: 13 months and a little (CC-176). */
export const TELEMETRY_DAILY_KEEP_DAYS = 400;
/** How long a day's run record is kept. The job only looks back 30 days. */
export const TELEMETRY_RUNS_KEEP_DAYS = 40;
const DAY_S = 24 * 60 * 60;
const DUPLICATE_KEY = 11000;

/**
 * @typedef {Object} TelemetryDailyDoc   persistence object: one India day's total of one event for one group of
 *   catalogue fields (CC-176). Anonymous: the hourly counters it comes from hold no id, and `group` holds only fields
 *   the rollup spec lists. `key` is the group written as text, for the unique index, and `fields` the group's field
 *   names, sorted and joined by commas, so the database picks a group. `version` is the run that wrote the row: a day
 *   is read only in the version its run record names (`telemetry_daily_runs.version`). `at` is the start of the day,
 *   for the 400 day TTL
 * @property {string} day
 * @property {Date} at
 * @property {string} event
 * @property {string} key
 * @property {string} fields
 * @property {string} version
 * @property {Record<string, string | boolean>} group
 * @property {number} count
 * @property {Record<string, { n: number, p50: number, p75: number, p95: number, buckets: Array<[number, number]> }>} [timings]
 */

const dailySchema = new mongoose.Schema(
  {
    _id: { type: String },
    day: { type: String, required: true },
    at: { type: Date, required: true },
    event: { type: String, required: true },
    key: { type: String, required: true },
    fields: { type: String, required: true },
    version: { type: String, required: true },
    group: { type: mongoose.Schema.Types.Mixed, required: true },
    count: { type: Number, required: true },
    timings: { type: mongoose.Schema.Types.Mixed },
  },
  { collection: "telemetry_daily", versionKey: false, strict: "throw", minimize: false },
);
dailySchema.index({ day: 1, event: 1, key: 1, version: 1 }, { unique: true });
dailySchema.index({ event: 1, fields: 1, day: 1 });
dailySchema.index({ at: 1 }, { expireAfterSeconds: TELEMETRY_DAILY_KEEP_DAYS * DAY_S });

/**
 * One India day's run record: who holds its lease and until when, and when it was last rolled up. `_id` is the day.
 */
const runSchema = new mongoose.Schema(
  {
    _id: { type: String },
    at: { type: Date, required: true },
    owner: { type: String, default: null },
    leaseUntil: { type: Date, default: null },
    doneAt: { type: Date, default: null },
    version: { type: String, default: null },
  },
  { collection: "telemetry_daily_runs", versionKey: false, strict: "throw" },
);
runSchema.index({ at: 1 }, { expireAfterSeconds: TELEMETRY_RUNS_KEEP_DAYS * DAY_S });

const HIDDEN = Object.freeze({ _id: 0, at: 0, key: 0, fields: 0, version: 0 });

/**
 * Daily telemetry totals and their run records in MongoDB (CC-176). Collections of their own, which only telemetry
 * reads or writes.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createTelemetryDailyDao({ connection }) {
  const Daily = connection.model("TelemetryDaily", dailySchema);
  const Run = connection.model("TelemetryDailyRun", runSchema);

  return Object.freeze({
    ensureIndexes: () => Promise.all([Daily.syncIndexes(), Run.syncIndexes()]),

    /**
     * Replaces every total of a day with these rows, so that a reader sees the old day or the new one, never a part
     * (review of #176): the rows go in under a new version, the day's run record then names that version in one
     * update, and the old versions go last. Running a day again with the same counters gives the same rows.
     *
     * @param {{ day: string, at: Date, rows: ReadonlyArray<{ event: string, key: string, fields: string, group: object, count: number, timings?: object }> }} input
     */
    async replaceDay({ day, at, rows }) {
      const version = randomUUID();
      const docs = rows.map((row) => ({ _id: randomUUID(), day, at, version, ...row }));
      // Checked against the schema first, so a field the schema lacks never reaches the database.
      docs.forEach((doc) => new Daily(doc).validateSync());
      if (docs.length > 0) await Daily.insertMany(docs, { ordered: true, lean: true });
      await Run.updateOne(
        { _id: day },
        { $set: { version }, $setOnInsert: { at, owner: null, leaseUntil: null, doneAt: null } },
        { upsert: true },
      );
      await Daily.deleteMany({ day, version: { $ne: version } });
    },

    /**
     * The rows of each day in the version its run record names, so a day being replaced reads whole.
     *
     * @param {{ from: string, to: string, events: ReadonlyArray<string>, fields?: string, dropBuckets?: ReadonlyArray<string> }} range
     *   days included at both ends. `fields`: only the group of these field names (sorted, comma separated, "" for
     *   the event's own total). `dropBuckets`: timings whose buckets are left in the database
     * @returns {Promise<Array<Omit<TelemetryDailyDoc, "at" | "key" | "fields" | "version">>>} by day, event and group
     */
    async read({ from, to, events, fields, dropBuckets = [] }) {
      const runs = await Run.find(
        { _id: { $gte: from, $lte: to }, version: { $ne: null } },
        { version: 1 },
      ).lean();
      if (runs.length === 0) return [];
      const projection = {
        ...HIDDEN,
        ...Object.fromEntries(dropBuckets.map((name) => [`timings.${name}.buckets`, 0])),
      };
      return Daily.find(
        {
          event: { $in: [...events] },
          ...(fields !== undefined && { fields }),
          $or: runs.map(({ _id, version }) => ({ day: _id, version })),
        },
        projection,
      )
        .sort({ day: 1, event: 1, key: 1 })
        .lean();
    },

    /**
     * Takes a day's lease when nobody holds it or it ran out. A second process asking at the same time gets `false`.
     *
     * @param {{ day: string, at: Date, owner: string, now: Date, until: Date }} lease
     * @returns {Promise<boolean>}
     */
    async acquireRun({ day, at, owner, now, until }) {
      try {
        await Run.findOneAndUpdate(
          { _id: day, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
          { $set: { owner, leaseUntil: until }, $setOnInsert: { at, doneAt: null } },
          { upsert: true },
        );
        return true;
      } catch (err) {
        // The day exists with a lease still running, so the upsert tried to make it again.
        if (err?.code === DUPLICATE_KEY) return false;
        throw err;
      }
    },

    /** Marks a day rolled up and gives its lease back, if this owner still holds it. */
    async finishRun({ day, owner, now }) {
      await Run.updateOne({ _id: day, owner }, { $set: { doneAt: now, leaseUntil: null, owner: null } });
    },

    /** Gives a lease back after a failure, if this owner still holds it, so the next tick can try again. */
    async releaseRun({ day, owner, now }) {
      await Run.updateOne({ _id: day, owner }, { $set: { leaseUntil: now, owner: null } });
    },

    /**
     * @param {{ from: string, to: string }} range  days included at both ends
     * @returns {Promise<string[]>} the days with a finished run, oldest first
     */
    async doneDays({ from, to }) {
      const runs = await Run.find({ _id: { $gte: from, $lte: to }, doneAt: { $ne: null } }, { _id: 1 })
        .sort({ _id: 1 })
        .lean();
      return runs.map(({ _id }) => _id);
    },
  });
}
