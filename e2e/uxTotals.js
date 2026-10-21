import { randomUUID } from "node:crypto";
import { groupKeyOf, rollUpDay } from "../apps/server/src/domain/telemetry/rollups.js";
import { uxSeedEvents } from "../apps/server/src/testing/uxSeed.js";
import { addDays, dayOf, startOfDay } from "../apps/server/src/utils/indiaTime.js";

// The UX page's seeded totals (CC-177): made-up daily totals for the 28 complete India days before the server starts,
// rolled up by the real rollup spec from the seed's counters, as `telemetry_daily` documents. Nothing in them is about
// a person: there are no people, only totals, and some groups are 1 to 4 on purpose so "fewer than 5" shows.

/** How many days back the seed reaches: a 7 day range and the 7 before it, and the 4 weeks the first move compares. */
const DAYS = 28;

/**
 * @param {number} now  ms
 * @returns {Promise<Array<object>>} the documents of `telemetry_daily`
 */
export async function seededUxTotals(now) {
  const today = dayOf(now);
  const days = Array.from({ length: DAYS }, (_, index) => addDays(today, -(index + 1)));
  const perDay = await Promise.all(
    days.map(async (day, index) => {
      const events = uxSeedEvents({ day, scale: index < 7 ? 1 : 0.8 });
      const counters = events.map(({ receivedAt, ...fields }) => ({ ...fields, hour: receivedAt, count: 1 }));
      return (await rollUpDay({ day, counters })).map(({ event, group, count, timings }) => ({
        _id: randomUUID(),
        day,
        at: new Date(startOfDay(day)),
        event,
        key: groupKeyOf(group),
        group,
        count,
        ...(timings && { timings }),
      }));
    }),
  );
  return perDay.flat();
}
