import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { CLIENT_COMMON_FIELDS, SERVER_COMMON_FIELDS, TELEMETRY_EVENTS } from "@classicade/shared";

/** How long MongoDB keeps an hour's counters, in days (CC-175, owner 2026-10-20). */
export const TELEMETRY_KEEP_DAYS = 30;
const DAY_S = 24 * 60 * 60;

/**
 * @typedef {Object} TelemetryCountDoc   persistence object: how many events of one tuple of catalogue fields arrived in
 *   one India hour (CC-175, owner review 2026-10-21). No single event is kept, so nothing says which events came
 *   together or in which order. `key` is the tuple written as text, for the unique index. `_id` is a random UUID
 *   rather than an ObjectId, which would hold the second the counter was made
 * @property {string} key
 * @property {Date} hour
 * @property {number} count
 * @property {string} name
 * @property {string} build
 * @property {string} tier
 */

// Every field a tuple may have. Anything else is refused by the schema, a second check after the catalogue's.
const FIELD_NAMES = [
  ...new Set([
    ...Object.keys(CLIENT_COMMON_FIELDS),
    ...Object.keys(SERVER_COMMON_FIELDS),
    ...Object.values(TELEMETRY_EVENTS).flatMap(({ fields }) => Object.keys(fields)),
  ]),
];

const schema = new mongoose.Schema(
  {
    _id: { type: String },
    key: { type: String, required: true },
    hour: { type: Date, required: true },
    count: { type: Number, required: true },
    name: { type: String, required: true },
    build: { type: String, required: true },
    tier: { type: String, required: true },
    ...Object.fromEntries(FIELD_NAMES.map((field) => [field, { type: mongoose.Schema.Types.Mixed }])),
  },
  { collection: "telemetry_counts", versionKey: false, strict: "throw" },
);
schema.index({ hour: 1, key: 1 }, { unique: true });
// MongoDB deletes an hour's counters 30 days after it, checked about once a minute. The same index answers the day's
// count, the purge and the nightly read (CC-176).
schema.index({ hour: 1 }, { expireAfterSeconds: TELEMETRY_KEEP_DAYS * DAY_S });

const LIST_FIELDS = "-_id -key";

/**
 * Anonymous telemetry counters in MongoDB (CC-175). A collection of its own, which only telemetry reads or writes.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createTelemetryCountDao({ connection }) {
  const Count = connection.model("TelemetryCount", schema);

  return Object.freeze({
    ensureIndexes: () => Count.syncIndexes(),

    /**
     * Adds each row's count to its tuple and hour, making the counter the first time.
     *
     * @param {ReadonlyArray<{ key: string, hour: Date, fields: Record<string, unknown>, count: number }>} rows
     */
    async addCounts(rows) {
      if (rows.length === 0) return;
      // Checked against the schema first, as an insert would be, so a key the catalogue lacks is never written.
      rows.forEach(({ key, hour, fields, count }) =>
        new Count({ _id: "check", key, hour, count, ...fields }).validateSync(),
      );
      await Count.bulkWrite(
        rows.map(({ key, hour, fields, count }) => ({
          updateOne: {
            filter: { key, hour },
            update: { $inc: { count }, $setOnInsert: { _id: randomUUID(), ...fields } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    },

    /**
     * @param {Date} from
     * @returns {Promise<number>} how many events the counters from then on hold
     */
    async countSince(from) {
      const [total] = await Count.aggregate([
        { $match: { hour: { $gte: from } } },
        { $group: { _id: null, events: { $sum: "$count" } } },
      ]);
      return total?.events ?? 0;
    },

    /**
     * @param {Date} before
     * @returns {Promise<number>} how many events the deleted counters held
     */
    async deleteBefore(before) {
      const filter = { hour: { $lt: before } };
      const events = (
        await Count.aggregate([{ $match: filter }, { $group: { _id: null, n: { $sum: "$count" } } }])
      )[0];
      await Count.deleteMany(filter);
      return events?.n ?? 0;
    },

    /**
     * @param {{ from: Date, to: Date, limit: number }} range
     * @returns {Promise<Array<Omit<TelemetryCountDoc, "key">>>} by hour, then by tuple, without `_id` or `key`
     */
    list: ({ from, to, limit }) =>
      Count.find({ hour: { $gte: from, $lt: to } }, LIST_FIELDS)
        .sort({ hour: 1, key: 1 })
        .limit(limit)
        .lean(),
  });
}
