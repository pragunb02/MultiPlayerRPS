import { assertDefined } from "../../utils/assert.js";
import { FEWER_THAN_MIN, MIN_GROUP_SIZE } from "../analytics/privacy.js";
import { bucketPercentiles, groupKeyOf, mergeBuckets } from "./rollups.js";

export { FEWER_THAN_MIN };

/**
 * A telemetry total for the console: `"<5"` for 1 to 4 (ADR-036.2, CC-176 owner default: every telemetry total,
 * because one person can make all of a small count). Zero points at nobody, so it is shown.
 *
 * @param {number} count
 * @returns {number | typeof FEWER_THAN_MIN}
 */
export const hideSmall = (count) => (count === 0 || count >= MIN_GROUP_SIZE ? count : FEWER_THAN_MIN);

const small = (count) => count > 0 && count < MIN_GROUP_SIZE;
const round = (value) => Math.round(value * 10_000) / 10_000;

/**
 * A share from 0 to 1, or `"<5"` when its part or its whole is 1 to 4, so a shown share never gives away a hidden
 * count. Zero over a whole of zero is hidden too: there is no share.
 *
 * @param {number} part
 * @param {number} whole
 * @returns {number | typeof FEWER_THAN_MIN}
 */
export const shareOrHidden = (part, whole) =>
  whole === 0 || small(part) || small(whole) ? FEWER_THAN_MIN : round(part / whole);

/**
 * A rate per `per` (such as dead clicks per 100 presses), or `"<5"` when its part or its whole is 1 to 4, or its whole
 * is 0. The check is made on the counts and the scaling after it, so a shown rate never gives away a hidden count
 * (review of #176, ADR-036.2): multiplying the part first would let 3 in 200 show as 1.5.
 *
 * @param {{ part: number, whole: number, per: number }} counts
 * @returns {number | typeof FEWER_THAN_MIN}
 */
export function ratePer({ part, whole, per }) {
  if (whole === 0 || small(part) || small(whole)) return FEWER_THAN_MIN;
  return round((part * per) / whole);
}

/** A timing's percentiles for the console: hidden when fewer than 5 events carried it. */
export function hideTimings(timings) {
  if (timings === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(timings).map(([field, { n, p50, p75, p95 }]) => [
      field,
      n < MIN_GROUP_SIZE
        ? { n: hideSmall(n), p50: FEWER_THAN_MIN, p75: FEWER_THAN_MIN, p95: FEWER_THAN_MIN }
        : { n, p50, p75, p95 },
    ]),
  );
}

/**
 * Reads the daily totals (CC-176) for the console. `totals` and `series` give exact numbers to the domain, which
 * works out ratios and colours on them (CC-313 section 5) and hides small ones before anything leaves; `read` is the
 * same totals with `"<5"` already applied, for any caller that shows them as they are.
 *
 * @param {{ telemetryDailyAccessor: Pick<ReturnType<typeof import("../../data/telemetryDailyAccessor.js").createTelemetryDailyAccessor>, "read"> }} deps
 */
export function createTelemetryReport({ telemetryDailyAccessor }) {
  assertDefined(telemetryDailyAccessor, "telemetryDailyAccessor");

  /** The rows of one group of fields: the rollup writes every field of a group, null when left out. */
  async function rowsOf({ from, to, event, group }) {
    const fields = [...group].sort().join();
    const rows = await telemetryDailyAccessor.read({ from, to, events: [event] });
    return rows.filter((row) => Object.keys(row.group).sort().join() === fields);
  }

  /**
   * Each value of a group summed over a range of days, busiest first. A range's percentiles come from the days'
   * bucket counters (the upper edge of the bucket the rank falls in), so they never look better than they were.
   *
   * @param {{ from: string, to: string, event: string, group: ReadonlyArray<string> }} query
   * @returns {Promise<Array<{ group: Record<string, unknown>, count: number, timings?: Record<string, { n: number, p50: number, p75: number, p95: number }> }>>}
   */
  async function totals(query) {
    const sums = new Map();
    for (const row of await rowsOf(query)) {
      const key = groupKeyOf(row.group);
      const sum = sums.get(key) ?? { group: row.group, count: 0, buckets: {} };
      sum.count += row.count;
      Object.entries(row.timings ?? {}).forEach(([field, { buckets }]) => {
        (sum.buckets[field] ??= []).push(buckets);
      });
      sums.set(key, sum);
    }
    return [...sums.values()]
      .map(({ group, count, buckets }) => {
        const fields = Object.entries(buckets);
        return {
          group,
          count,
          ...(fields.length > 0 && {
            timings: Object.fromEntries(
              fields.map(([field, lists]) => [field, bucketPercentiles(mergeBuckets(lists))]),
            ),
          }),
        };
      })
      .sort((a, b) => b.count - a.count || (groupKeyOf(a.group) < groupKeyOf(b.group) ? -1 : 1));
  }

  return Object.freeze({
    totals,

    /**
     * Each day's rows of a group, with that day's exact percentiles.
     *
     * @param {{ from: string, to: string, event: string, group: ReadonlyArray<string> }} query
     */
    series: async (query) =>
      (await rowsOf(query)).map(({ day, group, count, timings }) => ({
        day,
        group,
        count,
        ...(timings && {
          timings: Object.fromEntries(
            Object.entries(timings).map(([field, { n, p50, p75, p95 }]) => [field, { n, p50, p75, p95 }]),
          ),
        }),
      })),

    /**
     * The totals of `totals`, with `"<5"` applied to every count and every percentile of fewer than 5 values.
     *
     * @param {{ from: string, to: string, event: string, group: ReadonlyArray<string> }} query
     */
    read: async (query) =>
      (await totals(query))
        .map(({ group, count, timings }) => ({
          group,
          count: hideSmall(count),
          ...(timings && { timings: hideTimings(timings) }),
        }))
        .sort((a, b) => (groupKeyOf(a.group) < groupKeyOf(b.group) ? -1 : 1)),
  });
}
