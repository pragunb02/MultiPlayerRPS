import { ERROR_CODES } from "../errors.js";

/**
 * The few telemetry values and helpers the web app needs before its usage counts load (CC-174, CC-322): who the
 * player is, how the page load arrived, the buckets, the names an error may carry, the longest times, and rounding a
 * time or bucketing a number. They live apart from the catalogue (`events.js`) and the field rules (`fields.js`), so
 * the page's first download does not carry every event and field with them.
 */

/** `player_kind`: no session yet, a guest or an account. */
export const TELEMETRY_PLAYER_KINDS = Object.freeze({
  VISITOR: "visitor",
  GUEST: "guest",
  ACCOUNT: "account",
});

/** How a page load arrived (EVENTS.md 3.1), from a fixed list of referrer hosts, never the referrer itself. */
export const TELEMETRY_ENTRIES = Object.freeze({
  SHARED_LINK: "shared_link",
  DIRECT: "direct",
  ROOM_LINK: "room_link",
  SEARCH: "search",
  SOCIAL: "social",
  OTHER_SITE: "other_site",
});

/** The buckets of the bucketed fields, each label a fixed string. */
export const TELEMETRY_BUCKETS = Object.freeze({
  ACTIVE_S: Object.freeze(["0-10", "10-30", "30-60", "60-120", "120-300", "300-900", "900-1800", "1800+"]),
  VISIT_PRESSES: Object.freeze(["0", "1-5", "6-20", "21+"]),
  RAGE_PRESSES: Object.freeze(["3", "4", "5", "6+"]),
  AFTER_S: Object.freeze(["0-10", "10-60", "60-600", "600+"]),
  GUEST_MATCHES: Object.freeze(["0", "1", "2-5", "6-20", "21+"]),
  GUEST_AGE_DAYS: Object.freeze(["0", "1", "2-7", "8+"]),
  // CC-313
  SHOWN_MS: Object.freeze(["0-1s", "1-3s", "3-10s", "10s+"]),
  STACK: Object.freeze(["0", "1", "2+"]),
  INTERRUPTIONS: Object.freeze(["0", "1", "2", "3-5", "6+"]),
  BLOCKING_INTERRUPTIONS: Object.freeze(["0", "1", "2+"]),
  INTERRUPTIONS_BEFORE: Object.freeze(["0", "1", "2", "3+"]),
  WORDS: Object.freeze(["0-50", "51-100", "101-200", "201-400", "400+"]),
});

/** The constructor names `client_errored` may carry. Any other is `other`. */
export const TELEMETRY_ERROR_TYPES = Object.freeze([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "AppRequestError",
  "AbortError",
  "NetworkError",
  "SecurityError",
  "QuotaExceededError",
  "NotAllowedError",
  "other",
]);

/** Why the realtime connection changed: Socket.IO's disconnect reasons and the server's refusal codes. */
export const TELEMETRY_SOCKET_CODES = Object.freeze([
  "server_disconnect",
  "client_disconnect",
  "ping_timeout",
  "transport_close",
  "transport_error",
  "parse_error",
  "connect_error",
  ...Object.values(ERROR_CODES),
  "other",
]);

/** The longest time any field holds: an hour. */
const HOUR_MS = 60 * 60 * 1000;
/** The longest a single wait or page timing holds: two minutes. Longer is clamped. */
export const TELEMETRY_MAX_WAIT_MS = 2 * 60 * 1000;
/** The longest a time to first move holds: an hour. Longer is clamped. */
export const TELEMETRY_MAX_SINCE_LOAD_MS = HOUR_MS;

/**
 * A time as the catalogue keeps it: whole milliseconds rounded to 10, and never more than `max`.
 *
 * @param {number} value  milliseconds
 * @param {number} max
 * @returns {number}
 */
export const roundMs = (value, max) => Math.min(max, Math.max(0, Math.round(value / 10) * 10));

/**
 * The label of the bucket a number falls in. `edges` are the lower ends of each bucket after the first, so
 * `bucketOf(7, [1, 6, 21], ["0", "1-5", "6-20", "21+"])` is `"6-20"`.
 *
 * @param {number} value
 * @param {ReadonlyArray<number>} edges  ascending
 * @param {ReadonlyArray<string>} labels  one more than `edges`
 * @returns {string}
 */
export function bucketOf(value, edges, labels) {
  const index = edges.findIndex((edge) => value < edge);
  return labels[index === -1 ? edges.length : index];
}
