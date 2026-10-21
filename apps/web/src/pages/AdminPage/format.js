import { ANALYTICS_NOT_COUNTED, ANALYTICS_NOT_KEPT, getGame } from "@classicade/shared";

/** What the server sends instead of a group of 1 to 4 people (CC-233). */
export const FEWER_THAN_MIN = "<5";
/** The same, in words, for the screen and for exported files. */
export const FEWER_THAN_MIN_TEXT = "fewer than 5";
/** What a total whose data has already been removed says, on screen and in exported files. */
export const NOT_KEPT_TEXT = "no longer kept";
/** What a count the server could not see in full says, on screen and in exported files (CC-255). */
export const NOT_COUNTED_TEXT = "not counted";

const INDIA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const numbers = new Intl.NumberFormat("en-IN");

/**
 * Today in India time, as "YYYY-MM-DD". The console counts days in India time, like the server.
 *
 * @param {number} now  milliseconds
 */
export const indiaToday = (now) => new Date(now + INDIA_OFFSET_MS).toISOString().slice(0, 10);

/**
 * The day `count` days after `day`.
 *
 * @param {string} day  "YYYY-MM-DD"
 * @param {number} count
 */
export const addDays = (day, count) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + count * DAY_MS).toISOString().slice(0, 10);

/**
 * A count for the screen: "1,234", "fewer than 5" for a hidden group, or "no longer kept" when the data behind it
 * has been removed.
 *
 * @param {number | string} value
 */
export function formatCount(value) {
  if (value === FEWER_THAN_MIN) return FEWER_THAN_MIN_TEXT;
  if (value === ANALYTICS_NOT_COUNTED) return NOT_COUNTED_TEXT;
  return value === ANALYTICS_NOT_KEPT ? NOT_KEPT_TEXT : numbers.format(value);
}

/**
 * A share from 0 to 1 as a percentage with one decimal: "45.5%".
 *
 * @param {number | string} value
 */
export const formatShare = (value) =>
  value === FEWER_THAN_MIN ? FEWER_THAN_MIN_TEXT : `${(value * 100).toFixed(1)}%`;

/**
 * A change against the previous period: "+12.0%", "−5.0%", "new" when it grew from zero, and "" when a number
 * is hidden and there is nothing to compare.
 *
 * @param {number | string} change
 */
export function formatChange(change) {
  if (change === "new") return "new";
  if (typeof change !== "number") return "";
  const percent = `${Math.abs(change * 100).toFixed(1)}%`;
  if (change > 0) return `+${percent}`;
  return change < 0 ? `−${percent}` : "no change";
}

/**
 * A length of time: "45 s", "3 min 20 s".
 *
 * @param {number | string} seconds
 */
export function formatSeconds(seconds) {
  if (seconds === FEWER_THAN_MIN) return FEWER_THAN_MIN_TEXT;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return minutes === 0 ? `${whole} s` : `${minutes} min ${whole % 60} s`;
}

/**
 * A plain number with up to 2 decimals: "2.5".
 *
 * @param {number | string} value
 */
export const formatDecimal = (value) =>
  value === FEWER_THAN_MIN ? FEWER_THAN_MIN_TEXT : numbers.format(Math.round(value * 100) / 100);

/** What a number with nothing behind it yet says (CC-177): no events in the period, or a p75 of none. */
export const NO_DATA_TEXT = "no data";

/**
 * A time in milliseconds: "180 ms", "2.5 s", "fewer than 5" for a percentile of fewer than 5 values (CC-177).
 *
 * @param {number | string | null} value
 */
export function formatMs(value) {
  if (value === FEWER_THAN_MIN) return FEWER_THAN_MIN_TEXT;
  if (typeof value !== "number") return NO_DATA_TEXT;
  return value < 1000 ? `${numbers.format(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

/**
 * A layout shift score with two decimals (CC-177).
 *
 * @param {number | string | null} value
 */
export function formatCls(value) {
  if (value === FEWER_THAN_MIN) return FEWER_THAN_MIN_TEXT;
  return typeof value === "number" ? value.toFixed(2) : NO_DATA_TEXT;
}

/** How each kind of value is shown on screen. */
export const FORMATS = Object.freeze({
  count: formatCount,
  share: formatShare,
  seconds: formatSeconds,
  decimal: formatDecimal,
  ms: formatMs,
  cls: formatCls,
  text: (value) => String(value),
});

/**
 * A value as it goes into an exported file: numbers stay plain numbers so a spreadsheet can add them up, and a
 * hidden group or a removed total is written in words.
 *
 * @param {number | string} value
 */
export function csvValue(value) {
  if (value === FEWER_THAN_MIN) return FEWER_THAN_MIN_TEXT;
  if (value === ANALYTICS_NOT_COUNTED) return NOT_COUNTED_TEXT;
  return value === ANALYTICS_NOT_KEPT ? NOT_KEPT_TEXT : value;
}

/**
 * A game's name, or its id for a game this build does not know.
 *
 * @param {string} gameId
 */
export const gameName = (gameId) => getGame(gameId)?.name ?? gameId;

/**
 * A leaderboard's name from its stored id: "xp" is the overall XP board, "wins:chess" a game's wins board.
 *
 * @param {string} board
 */
export function boardName(board) {
  if (board === "xp") return "Overall XP";
  return board.startsWith("wins:") ? `${gameName(board.slice(5))} wins` : board;
}

/** Weekdays as the server numbers them, 1 to 7 from Monday. */
export const WEEKDAYS = Object.freeze(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

/**
 * A number to draw: a hidden group is drawn as nothing.
 *
 * @param {number | string} value
 */
export const drawable = (value) => (typeof value === "number" ? value : 0);
