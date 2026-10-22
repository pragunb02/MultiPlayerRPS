import { assertDefined } from "../utils/assert.js";

/**
 * @typedef {Readonly<Record<string, string | number | boolean>> & { build: string, tier: string, hour: number, count: number }} TelemetryCount
 *   domain model: how many events of one tuple of catalogue fields arrived in one India hour (`hour`, its start in
 *   ms). No id of anyone, and no single event
 */

/** The tuple written as text, the same for the same fields in any order. */
export const keyOf = (fields) => JSON.stringify(Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)));

const toCount = ({ hour, count, ...fields }) => Object.freeze({ ...fields, hour: hour.getTime(), count });

/**
 * Provides the telemetry counters to the domain (CC-175, owner review 2026-10-21). Events are added to counters, one
 * per tuple of catalogue fields and India hour, so no single event, no order and no batch is ever stored. The
 * nightly totals (CC-176) read the counters through `list`.
 *
 * @param {{ telemetryCountDao: ReturnType<typeof import("../persistence/telemetryCountDao.js").createTelemetryCountDao> }} deps
 */
export function createTelemetryAccessor({ telemetryCountDao }) {
  assertDefined(telemetryCountDao, "telemetryCountDao");

  return Object.freeze({
    /**
     * Counts events: equal tuples of the same hour become one counter.
     *
     * @param {ReadonlyArray<Record<string, string | number | boolean> & { receivedAt: number }>} events  `receivedAt`
     *   is the start of the India hour
     */
    add(events) {
      const rows = new Map();
      for (const { receivedAt, ...fields } of events) {
        const key = keyOf(fields);
        const id = `${receivedAt} ${key}`;
        const row = rows.get(id) ?? { key, hour: new Date(receivedAt), fields, count: 0 };
        row.count += 1;
        rows.set(id, row);
      }
      return telemetryCountDao.addCounts([...rows.values()]);
    },

    /**
     * @param {number} from  ms, included
     * @returns {Promise<number>} how many events arrived from then on
     */
    countSince: (from) => telemetryCountDao.countSince(new Date(from)),

    /**
     * @param {number} before  ms, not included
     * @returns {Promise<number>} how many events were deleted
     */
    deleteBefore: (before) => telemetryCountDao.deleteBefore(new Date(before)),

    /**
     * The counters of a range, by hour and then by tuple, for the nightly totals (CC-176) and tests.
     *
     * @param {{ from: number, to: number, limit: number }} range  `from` included, `to` not
     * @returns {Promise<ReadonlyArray<TelemetryCount>>}
     */
    list: async ({ from, to, limit }) =>
      Object.freeze(
        (await telemetryCountDao.list({ from: new Date(from), to: new Date(to), limit })).map(toCount),
      ),
  });
}
