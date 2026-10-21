/**
 * The names account suspensions are made of (CC-334, ADR-078). The owner console, the sign-in page and the server
 * all read them here. Code uses the names, never a place in a list.
 */
import { REPORT_KEEP_DAYS } from "./reports.js";

const HOUR_MS = 60 * 60 * 1000;

/** How long the owner can suspend an account for. The console offers them in this order, shortest first. */
export const SUSPENSION_DURATION = Object.freeze({
  DAY: "24h",
  WEEK: "7d",
  MONTH: "30d",
  UNTIL_LIFTED: "until-lifted",
});
export const SUSPENSION_DURATIONS = Object.freeze(Object.values(SUSPENSION_DURATION));

/** How long each duration lasts. "Until lifted" has none: it lasts until the owner lifts it. */
export const SUSPENSION_DURATION_MS = Object.freeze({
  [SUSPENSION_DURATION.DAY]: 24 * HOUR_MS,
  [SUSPENSION_DURATION.WEEK]: 7 * 24 * HOUR_MS,
  [SUSPENSION_DURATION.MONTH]: 30 * 24 * HOUR_MS,
});

/** Why the owner suspends an account. A closed list, and no free text, as reports (ADR-071.2). */
export const SUSPENSION_REASON = Object.freeze({
  CHEATING: "cheating",
  HARASSMENT: "harassment",
  NAME: "name",
  OTHER: "other",
});
export const SUSPENSION_REASONS = Object.freeze(Object.values(SUSPENSION_REASON));

/**
 * How long a suspension is kept after it ended or was lifted, the same as a report: the IT Rules record period.
 * MongoDB removes it after that. One that lasts until lifted is kept while it lasts.
 */
export const SUSPENSION_KEEP_DAYS = REPORT_KEEP_DAYS;

/** The action a suspension closes a report group's open reports with. Not one of REPORT_ACTIONS. */
export const SUSPENSION_REPORT_ACTION = "suspend";

/** `details.reason` of the 403 a suspended account gets when it signs in with the right password. */
export const SUSPENDED_REASON = "suspended";
