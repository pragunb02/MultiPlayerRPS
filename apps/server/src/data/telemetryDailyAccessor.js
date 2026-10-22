import { assertDefined } from "../utils/assert.js";

/**
 * @typedef {Readonly<{ day: string, event: string, group: Readonly<Record<string, string | boolean>>, count: number, timings?: Readonly<Record<string, { n: number, p50: number, p75: number, p95: number, buckets: ReadonlyArray<readonly [number, number]> }>> }>} TelemetryDaily
 *   domain model: one India day's anonymous total of one event for one group of catalogue fields (CC-176)
 */

/** A group's field names as the database finds them: sorted and joined by commas, "" for an event's own total. */
export const fieldsOf = (names) => [...names].sort().join(",");

/** The group written as text, the same for the same fields in any order. */
const keyOf = (group) => JSON.stringify(Object.entries(group).sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * Provides the daily telemetry totals and their run records to the domain (CC-176).
 *
 * @param {{ telemetryDailyDao: ReturnType<typeof import("../persistence/telemetryDailyDao.js").createTelemetryDailyDao> }} deps
 */
export function createTelemetryDailyAccessor({ telemetryDailyDao }) {
  assertDefined(telemetryDailyDao, "telemetryDailyDao");

  return Object.freeze({
    /**
     * @param {{ day: string, dayStart: number, rows: ReadonlyArray<Omit<TelemetryDaily, "day">> }} input  `dayStart`
     *   the moment the India day starts, in ms
     */
    replaceDay: ({ day, dayStart, rows }) =>
      telemetryDailyDao.replaceDay({
        day,
        at: new Date(dayStart),
        rows: rows.map(({ event, group, count, timings }) => ({
          event,
          key: keyOf(group),
          fields: fieldsOf(Object.keys(group)),
          group,
          count,
          ...(timings && { timings }),
        })),
      }),

    /**
     * @param {{ from: string, to: string, events: ReadonlyArray<string>, fields?: string, dropBuckets?: ReadonlyArray<string> }} range
     *   `fields`: one group's field names (`fieldsOf`). `dropBuckets`: timings read without their buckets
     * @returns {Promise<ReadonlyArray<TelemetryDaily>>}
     */
    read: async (range) =>
      Object.freeze((await telemetryDailyDao.read(range)).map((row) => Object.freeze(row))),

    /** @param {{ day: string, dayStart: number, owner: string, now: number, leaseMs: number }} lease */
    acquireRun: ({ day, dayStart, owner, now, leaseMs }) =>
      telemetryDailyDao.acquireRun({
        day,
        at: new Date(dayStart),
        owner,
        now: new Date(now),
        until: new Date(now + leaseMs),
      }),

    /** @param {{ day: string, owner: string, now: number }} run */
    finishRun: ({ day, owner, now }) => telemetryDailyDao.finishRun({ day, owner, now: new Date(now) }),

    /** @param {{ day: string, owner: string, now: number }} run */
    releaseRun: ({ day, owner, now }) => telemetryDailyDao.releaseRun({ day, owner, now: new Date(now) }),

    /** @param {{ from: string, to: string }} range */
    doneDays: (range) => telemetryDailyDao.doneDays(range),
  });
}
