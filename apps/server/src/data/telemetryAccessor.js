import { assertDefined } from "../utils/assert.js";

/**
 * @typedef {Readonly<Record<string, string | number | boolean>> & { build: string, tier: string, receivedAt: number }} TelemetryEvent
 *   domain model: one stored event, its catalogue fields as sent, and when it arrived (the start of an India hour,
 *   in ms). No id of anyone
 */

const toEvent = ({ received_at: receivedAt, ...fields }) =>
  Object.freeze({ ...fields, receivedAt: receivedAt.getTime() });

/**
 * Provides stored telemetry events to the domain (CC-175). The nightly totals (CC-176) read them through `list`.
 *
 * @param {{ telemetryEventDao: ReturnType<typeof import("../persistence/telemetryEventDao.js").createTelemetryEventDao> }} deps
 */
export function createTelemetryAccessor({ telemetryEventDao }) {
  assertDefined(telemetryEventDao, "telemetryEventDao");

  return Object.freeze({
    /**
     * Stores events.
     *
     * @param {ReadonlyArray<Record<string, string | number | boolean> & { receivedAt: number }>} events
     */
    add: (events) =>
      telemetryEventDao.insertMany(
        events.map(({ receivedAt, ...fields }) => ({ ...fields, received_at: new Date(receivedAt) })),
      ),

    /**
     * @param {number} from  ms, included
     * @returns {Promise<number>} how many events arrived from then on
     */
    countSince: (from) => telemetryEventDao.countSince(new Date(from)),

    /**
     * @param {number} before  ms, not included
     * @returns {Promise<number>} how many were deleted
     */
    deleteBefore: (before) => telemetryEventDao.deleteBefore(new Date(before)),

    /**
     * The events that arrived in a range, oldest first, for the nightly totals (CC-176) and tests.
     *
     * @param {{ from: number, to: number, limit: number }} range  `from` included, `to` not
     * @returns {Promise<ReadonlyArray<TelemetryEvent>>}
     */
    list: async ({ from, to, limit }) =>
      Object.freeze(
        (await telemetryEventDao.list({ from: new Date(from), to: new Date(to), limit })).map(toEvent),
      ),
  });
}
