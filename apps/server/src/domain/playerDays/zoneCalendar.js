import { INDIA_TIME_ZONE } from "../../utils/indiaTime.js";

/**
 * A player's days in their own time zone (CC-146, ADR-077). Pure: a day is a function of the moment and the IANA
 * zone, worked out with `Intl`, which reads the tz database in Node and in every browser, so summer time is right
 * everywhere. No library (ADR-008).
 *
 * @typedef {Object} ZoneRecord   a player's stored zone (see timeZoneAccessor)
 * @property {string} zone          the zone in use, canonical
 * @property {string} previousZone  the zone before the last change
 * @property {number} changedAt     when the last change was made, ms
 * @property {number} effectiveAt   when `zone` took over: the previous zone's next midnight after `changedAt`
 * @property {string} floorDay      the day after the previous zone's day at `changedAt`: the new zone never goes back
 *   before it, so no day repeats
 *
 * @typedef {{ kind: "local" | "utc" | "india", zone: string, dayOf: (ms: number) => string, nextDayAt: (ms: number) => number }} PlayerCalendar
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** A zone may change at most once in this long, the first set included (ADR-077.3). */
export const ZONE_CHANGE_LOCK_MS = 7 * DAY_MS;
const MAX_ZONE_LENGTH = 64;
const ZONE_PATTERN = /^[A-Za-z0-9_+\-/]+$/;

const formatters = new Map();
function formatterFor(zone) {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/**
 * The canonical name of a time zone, or `undefined` when it is not one `Intl` knows. Aliases become one name, so
 * `Asia/Kolkata` and `Asia/Calcutta` are the same zone.
 *
 * @param {unknown} text
 * @returns {string | undefined}
 */
export function canonicalZone(text) {
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    text.length > MAX_ZONE_LENGTH ||
    !ZONE_PATTERN.test(text)
  ) {
    return undefined;
  }
  try {
    return new Intl.DateTimeFormat("en", { timeZone: text }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** India time, the zone of a player whose zone is unknown (ADR-077.1), by its canonical name. */
export const DEFAULT_ZONE = /** @type {string} */ (canonicalZone(INDIA_TIME_ZONE));

/**
 * The day a moment falls on in a zone.
 *
 * @param {string} zone
 * @param {number} ms
 * @returns {string} "YYYY-MM-DD"
 */
export function dayIn(zone, ms) {
  const parts = formatterFor(zone).formatToParts(ms);
  const part = (type) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The first moment of a day in a zone: its midnight, or the first moment after it when summer time skips midnight
 * (as in `America/Santiago`). Found by a binary search, since a day can last 23 or 25 hours.
 *
 * @param {string} zone
 * @param {string} day  "YYYY-MM-DD"
 * @returns {number} ms
 */
export function startOfDayIn(zone, day) {
  const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
  // Every zone is between UTC-12 and UTC+14, so the day starts inside this window.
  let low = utcMidnight - 15 * HOUR_MS;
  let high = utcMidnight + 13 * HOUR_MS;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dayIn(zone, mid) >= day) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10);

/**
 * A player's calendar. With no record the player's zone is unknown and India time is used. After a change the old
 * zone keeps the day until its own midnight (`effectiveAt`), then the new zone applies, never before `floorDay`.
 *
 * @param {Readonly<ZoneRecord> | undefined} record
 * @returns {Readonly<PlayerCalendar>}
 */
export function zoneCalendar(record) {
  const zone = record?.zone ?? DEFAULT_ZONE;
  const dayOf = (ms) => {
    if (record !== undefined && ms < record.effectiveAt) {
      return dayIn(record.previousZone, ms);
    }
    const day = dayIn(zone, ms);
    return record !== undefined && day < record.floorDay ? record.floorDay : day;
  };
  return Object.freeze({
    kind: "local",
    zone,
    dayOf,
    nextDayAt: (ms) => {
      if (record !== undefined && ms < record.effectiveAt) {
        return record.effectiveAt;
      }
      return startOfDayIn(zone, nextDay(dayOf(ms)));
    },
  });
}

/**
 * Asks to use another zone from `now`. The first set and every change after it are at most once in
 * ZONE_CHANGE_LOCK_MS; the zone already in use changes nothing.
 *
 * @param {{ record: Readonly<ZoneRecord> | undefined, zone: string, now: number }} input  zone: canonical
 * @returns {{ outcome: "same", record: Readonly<ZoneRecord> | undefined }
 *   | { outcome: "locked", changeableAt: number }
 *   | { outcome: "changed", record: Readonly<ZoneRecord> }}
 */
export function changeZone({ record, zone, now }) {
  const current = record?.zone ?? DEFAULT_ZONE;
  if (zone === current) {
    return { outcome: "same", record };
  }
  if (record !== undefined && now < record.changedAt + ZONE_CHANGE_LOCK_MS) {
    return { outcome: "locked", changeableAt: record.changedAt + ZONE_CHANGE_LOCK_MS };
  }
  const calendar = zoneCalendar(record);
  const today = calendar.dayOf(now);
  return {
    outcome: "changed",
    record: Object.freeze({
      zone,
      previousZone: current,
      changedAt: now,
      effectiveAt: calendar.nextDayAt(now),
      floorDay: nextDay(today),
    }),
  };
}

/** UTC days: streaks and quests while `local_days` is off (ADR-013 before CC-146). */
export const UTC_CALENDAR = Object.freeze({
  kind: "utc",
  zone: "UTC",
  dayOf: (ms) => new Date(ms).toISOString().slice(0, 10),
  nextDayAt: (ms) => Math.floor(ms / DAY_MS) * DAY_MS + DAY_MS,
});
