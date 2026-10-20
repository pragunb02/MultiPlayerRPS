/**
 * The names reports are made of (CC-044, ADR-071). The dialog, the server's checks and the owner console all read
 * them here, so a new reason or action is one line in this file. Code uses the names, never a place in a list, and
 * the lists are only for showing every value in order.
 */

/** Why a player reports another. A closed list: the dialog shows them in this order. */
export const REPORT_REASON = Object.freeze({
  NAME: "name",
  CHEATING: "cheating",
  HARASSMENT: "harassment",
  OTHER: "other",
});
export const REPORT_REASONS = Object.freeze(Object.values(REPORT_REASON));

/** Where the report was made: a room seat, a past match, or a public profile (ADR-065). */
export const REPORT_CONTEXT = Object.freeze({ ROOM: "room", MATCH: "match", PROFILE: "profile" });

/** Where a report is in the owner's queue. Never shown to the reporter or to the reported player. */
export const REPORT_STATUS = Object.freeze({ OPEN: "open", DISMISSED: "dismissed", ACTIONED: "actioned" });
export const REPORT_STATUSES = Object.freeze(Object.values(REPORT_STATUS));

/** What the owner can do with the open reports about one player. Suspension does not exist yet (ADR-071.6). */
export const REPORT_ACTION = Object.freeze({ DISMISS: "dismiss", RENAME: "rename" });
export const REPORT_ACTIONS = Object.freeze(Object.values(REPORT_ACTION));

/** How long a report is kept after it was made. MongoDB removes it after that (ADR-071.7). */
export const REPORT_KEEP_DAYS = 180;
