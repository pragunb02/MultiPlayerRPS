import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { CLIENT_COMMON_FIELDS, SERVER_COMMON_FIELDS, TELEMETRY_EVENTS } from "@classicade/shared";

/** How long MongoDB keeps a stored event, in days (CC-175, owner 2026-10-20). */
export const TELEMETRY_KEEP_DAYS = 30;
const DAY_S = 24 * 60 * 60;

/**
 * @typedef {Object} TelemetryEventDoc   persistence object: one anonymous event (CC-175, ADR-034). Its catalogue
 *   fields as sent, its build, its tier and `received_at`, the start of the India hour it arrived in. `_id` is a
 *   random UUID rather than an ObjectId, because an ObjectId holds the second it was made, finer than the hour
 * @property {string} name
 * @property {string} build
 * @property {string} tier
 * @property {Date} received_at
 */

// Every key any event may have. Anything else is refused by the schema, a second check after the catalogue's.
const FIELD_NAMES = [
  ...new Set([
    ...Object.keys(CLIENT_COMMON_FIELDS),
    ...Object.keys(SERVER_COMMON_FIELDS),
    ...Object.values(TELEMETRY_EVENTS).flatMap(({ fields }) => Object.keys(fields)),
  ]),
];

const schema = new mongoose.Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    name: { type: String, required: true },
    build: { type: String, required: true },
    tier: { type: String, required: true },
    received_at: { type: Date, required: true },
    ...Object.fromEntries(FIELD_NAMES.map((key) => [key, { type: mongoose.Schema.Types.Mixed }])),
  },
  { collection: "telemetry_events", versionKey: false, strict: "throw" },
);
// MongoDB deletes an event 30 days after the hour it arrived in, checked about once a minute. The same index
// answers the day's count, the purge and the nightly read (CC-176).
schema.index({ received_at: 1 }, { expireAfterSeconds: TELEMETRY_KEEP_DAYS * DAY_S });

const LIST_FIELDS = "-_id";

/**
 * Anonymous telemetry events in MongoDB (CC-175). A collection of its own, which only telemetry reads or writes.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createTelemetryEventDao({ connection }) {
  const Event = connection.model("TelemetryEvent", schema);

  return Object.freeze({
    ensureIndexes: () => Event.syncIndexes(),

    /**
     * @param {ReadonlyArray<Omit<TelemetryEventDoc, "_id">>} events
     */
    async insertMany(events) {
      if (events.length === 0) return;
      await Event.insertMany(events, { ordered: false, lean: false });
    },

    /**
     * @param {Date} from
     * @returns {Promise<number>}
     */
    countSince: (from) => Event.countDocuments({ received_at: { $gte: from } }),

    /**
     * @param {Date} before
     * @returns {Promise<number>} how many were deleted
     */
    async deleteBefore(before) {
      const { deletedCount } = await Event.deleteMany({ received_at: { $lt: before } });
      return deletedCount;
    },

    /**
     * @param {{ from: Date, to: Date, limit: number }} range
     * @returns {Promise<TelemetryEventDoc[]>} oldest first, without `_id`
     */
    list: ({ from, to, limit }) =>
      Event.find({ received_at: { $gte: from, $lt: to } }, LIST_FIELDS)
        .sort({ received_at: 1 })
        .limit(limit)
        .lean(),
  });
}
