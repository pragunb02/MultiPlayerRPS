// The owner console counts days, weeks and hours in India time, where most players live (ADR-015 and ADR-013
// amendments). India has kept one offset all year since 1945, with no summer time, so a fixed offset is exact and
// these functions stay pure. The database groups with the same zone ("Asia/Kolkata"), so both sides agree.

/** The zone name MongoDB groups by. */
export const INDIA_TIME_ZONE = "Asia/Kolkata";

const DAY_MS = 24 * 60 * 60 * 1000;
const INDIA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The buckets a series can be grouped into. */
export const BUCKETS = Object.freeze({ DAY: "day", WEEK: "week", MONTH: "month" });

/**
 * Whether a text is a real calendar day written as "YYYY-MM-DD". "2026-02-30" is not.
 *
 * @param {unknown} text
 * @returns {boolean}
 */
export function isDay(text) {
  if (typeof text !== "string" || !DAY_PATTERN.test(text)) {
    return false;
  }
  const ms = Date.parse(`${text}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === text;
}

/**
 * The India day a moment falls on.
 *
 * @param {number} ms  a moment in milliseconds
 * @returns {string} "YYYY-MM-DD"
 */
export const dayOf = (ms) => new Date(ms + INDIA_OFFSET_MS).toISOString().slice(0, 10);

/**
 * The moment an India day starts (midnight in India, 18:30 UTC the evening before).
 *
 * @param {string} day  "YYYY-MM-DD"
 * @returns {number} milliseconds
 */
export const startOfDay = (day) => Date.parse(`${day}T00:00:00.000Z`) - INDIA_OFFSET_MS;

/**
 * The day `count` days after `day` (before it when `count` is negative).
 *
 * @param {string} day
 * @param {number} count
 * @returns {string}
 */
export const addDays = (day, count) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + count * DAY_MS).toISOString().slice(0, 10);

/**
 * How many days `to` is after `from`. Negative when it is before.
 *
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
export const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);

/**
 * The Monday that starts the week of `day`. Weeks start on Monday, as the weekly boards do.
 *
 * @param {string} day
 * @returns {string}
 */
export function weekOf(day) {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/**
 * The bucket a day belongs to: the day itself, the Monday of its week, or its month as "YYYY-MM".
 *
 * @param {string} day
 * @param {string} bucket  a BUCKETS value
 * @returns {string}
 */
export function bucketOf(day, bucket) {
  if (bucket === BUCKETS.WEEK) {
    return weekOf(day);
  }
  return bucket === BUCKETS.MONTH ? day.slice(0, 7) : day;
}

/**
 * Every day from `from` to `to`, both included.
 *
 * @param {{ from: string, to: string }} range
 * @returns {string[]}
 */
export function daysOf({ from, to }) {
  return Array.from({ length: daysBetween(from, to) + 1 }, (_, index) => addDays(from, index));
}

/**
 * The buckets that cover a range, oldest first. The first and last can be partly outside it.
 *
 * @param {{ from: string, to: string, bucket: string }} range
 * @returns {string[]}
 */
export function bucketsOf({ from, to, bucket }) {
  return [...new Set(daysOf({ from, to }).map((day) => bucketOf(day, bucket)))];
}
