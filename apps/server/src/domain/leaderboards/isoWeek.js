const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Monday 00:00 UTC of the week containing `ms`. */
function mondayOf(ms) {
  const dayStart = Math.floor(ms / DAY_MS) * DAY_MS;
  const daysSinceMonday = (new Date(dayStart).getUTCDay() + 6) % 7;
  return dayStart - daysSinceMonday * DAY_MS;
}

/** India's offset from UTC, all year (no summer time since 1945): the weekly boards' week (ADR-015, CC-146). */
export const INDIA_WEEK_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * The ISO 8601 week (weeks start on Monday 00:00) containing a moment — the period of the weekly leaderboard.
 * Week 1 is the week with the year's first Thursday, so the last days of December can belong to week 1 of the next
 * year and the first days of January to week 52 or 53 of the previous one.
 *
 * @param {number} ms  a time in milliseconds
 * @param {number} [offsetMs]  the fixed offset of the week's clock from UTC: 0 for UTC, INDIA_WEEK_OFFSET_MS for
 *   Monday 00:00 India time
 * @returns {Readonly<{ id: string, startsAt: number, endsAt: number }>}  id like "2026-W42"; endsAt is exclusive
 */
export function isoWeek(ms, offsetMs = 0) {
  if (!Number.isFinite(ms)) {
    throw new RangeError("isoWeek needs a time in milliseconds");
  }
  if (offsetMs !== 0) {
    const local = isoWeek(ms + offsetMs);
    return Object.freeze({ id: local.id, startsAt: local.startsAt - offsetMs, endsAt: local.endsAt - offsetMs });
  }
  const startsAt = mondayOf(ms);
  const year = new Date(startsAt + 3 * DAY_MS).getUTCFullYear(); // the week's Thursday decides its year
  const firstWeekStart = mondayOf(Date.UTC(year, 0, 4)); // 4 January is always in week 1
  const week = (startsAt - firstWeekStart) / WEEK_MS + 1;
  return Object.freeze({
    id: `${year}-W${String(week).padStart(2, "0")}`,
    startsAt,
    endsAt: startsAt + WEEK_MS,
  });
}
