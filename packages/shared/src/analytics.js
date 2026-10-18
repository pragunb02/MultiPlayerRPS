/**
 * The owner console's limits and markers (CC-233), shared so the web form and the server agree.
 */

/** The longest range the console reports on, so one request cannot ask for years of work. */
export const ANALYTICS_MAX_RANGE_DAYS = 400;

/** What a total says when the data behind it has already been removed, so it is not shown as 0. */
export const ANALYTICS_NOT_KEPT = "not kept";

/** What a count of people says when a bounded read cannot see all of them, so it is not shown as 0 (CC-255). */
export const ANALYTICS_NOT_COUNTED = "not counted";
