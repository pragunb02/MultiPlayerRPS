import { ANALYTICS_MAX_RANGE_DAYS } from "@classicade/shared";
import { BUCKETS, daysBetween, isDay } from "../utils/indiaTime.js";
import { ValidationError } from "../utils/errors.js";

/** The longest range the owner console reports on, so one request cannot ask for years of work. */
export const MAX_RANGE_DAYS = ANALYTICS_MAX_RANGE_DAYS;

/**
 * @typedef {Object} AnalyticsRange
 * @property {string} from    first India day, "YYYY-MM-DD", included
 * @property {string} to      last India day, included
 * @property {"day" | "week" | "month"} bucket  how the series are grouped
 */

/**
 * The days an owner console report covers (CC-233), validated once.
 *
 * @param {{ from: unknown, to: unknown, bucket: unknown }} fields
 * @returns {Readonly<AnalyticsRange>}
 * @throws {ValidationError} when a day is not a real day, the range runs backwards or is too long, or the
 *   bucket is unknown
 */
export function createAnalyticsRange({ from, to, bucket }) {
  for (const [field, value] of Object.entries({ from, to })) {
    if (!isDay(value)) {
      throw new ValidationError(`${field} must be a day like 2026-10-17`, { details: { field } });
    }
  }
  const length = daysBetween(/** @type {string} */ (from), /** @type {string} */ (to)) + 1;
  if (length < 1 || length > MAX_RANGE_DAYS) {
    throw new ValidationError(`The range must run forwards and cover at most ${MAX_RANGE_DAYS} days`, {
      details: { field: "to" },
    });
  }
  if (!Object.values(BUCKETS).includes(/** @type {any} */ (bucket))) {
    throw new ValidationError(`bucket must be one of ${Object.values(BUCKETS).join(", ")}`, {
      details: { field: "bucket" },
    });
  }
  return Object.freeze({
    from: /** @type {string} */ (from),
    to: /** @type {string} */ (to),
    bucket: /** @type {AnalyticsRange["bucket"]} */ (bucket),
  });
}
