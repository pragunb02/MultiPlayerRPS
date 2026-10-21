import { describe, expect, it } from "vitest";
import {
  canonicalZone,
  changeZone,
  DEFAULT_ZONE,
  dayIn,
  startOfDayIn,
  UTC_CALENDAR,
  ZONE_CHANGE_LOCK_MS,
  zoneCalendar,
} from "./zoneCalendar.js";

// Every moment here is written out: nothing reads the real clock (CC-325).
const at = (iso) => Date.parse(iso);
const HOUR = 60 * 60 * 1000;

/** The days a calendar gives, one per hour, from `from` for `hours`, without repeats in a row. */
function daysSeen(calendar, from, hours) {
  const days = [];
  for (let hour = 0; hour < hours; hour++) {
    const day = calendar.dayOf(at(from) + hour * HOUR);
    if (days.at(-1) !== day) days.push(day);
  }
  return days;
}

describe("zoneCalendar (CC-146)", () => {
  it("turns the day at local midnight, not UTC midnight", () => {
    const newYork = zoneCalendar({
      zone: "America/New_York",
      previousZone: DEFAULT_ZONE,
      changedAt: 0,
      effectiveAt: 0,
      floorDay: "1970-01-01",
    });
    // Midnight in New York on 21 October 2026 is 04:00 UTC (summer time, UTC-4).
    expect(newYork.dayOf(at("2026-10-21T03:59:59.999Z"))).toBe("2026-10-20");
    expect(newYork.dayOf(at("2026-10-21T04:00:00.000Z"))).toBe("2026-10-21");
    expect(newYork.nextDayAt(at("2026-10-21T03:59:59.999Z"))).toBe(at("2026-10-21T04:00:00.000Z"));
    // At midnight exactly the new day has started, so the next one is a day later.
    expect(newYork.nextDayAt(at("2026-10-21T04:00:00.000Z"))).toBe(at("2026-10-22T04:00:00.000Z"));
  });

  it("starts each day at the zone's own midnight across summer time", () => {
    // New York leaves summer time on Sunday 1 November 2026: that day lasts 25 hours.
    expect(startOfDayIn("America/New_York", "2026-11-01")).toBe(at("2026-11-01T04:00:00.000Z"));
    expect(startOfDayIn("America/New_York", "2026-11-02")).toBe(at("2026-11-02T05:00:00.000Z"));
    // London starts summer time on Sunday 28 March 2027: that day lasts 23 hours.
    expect(startOfDayIn("Europe/London", "2027-03-28")).toBe(at("2027-03-28T00:00:00.000Z"));
    expect(startOfDayIn("Europe/London", "2027-03-29")).toBe(at("2027-03-28T23:00:00.000Z"));
    // Chile starts summer time at midnight on 6 September 2026: 00:00 never happens, the day starts at 01:00.
    expect(startOfDayIn("America/Santiago", "2026-09-06")).toBe(at("2026-09-06T04:00:00.000Z"));
    expect(dayIn("America/Santiago", at("2026-09-06T03:59:59.999Z"))).toBe("2026-09-05");
  });

  it("uses India time when the zone is unknown", () => {
    const unknown = zoneCalendar(undefined);
    expect(unknown.zone).toBe(DEFAULT_ZONE);
    // India midnight is 18:30 UTC the evening before, all year.
    expect(unknown.dayOf(at("2026-10-20T18:29:59.999Z"))).toBe("2026-10-20");
    expect(unknown.dayOf(at("2026-10-20T18:30:00.000Z"))).toBe("2026-10-21");
    expect(unknown.nextDayAt(at("2026-10-20T12:00:00.000Z"))).toBe(at("2026-10-20T18:30:00.000Z"));
  });

  it("knows real zones by one canonical name and refuses anything else", () => {
    expect(canonicalZone("Asia/Kolkata")).toBe(canonicalZone("Asia/Calcutta"));
    expect(canonicalZone("America/New_York")).toBe("America/New_York");
    expect(canonicalZone("UTC")).toBe("UTC");
    for (const bad of ["Mars/Olympus_Mons", "", "a".repeat(65), "Asia/Kolkata; drop", 42, undefined]) {
      expect(canonicalZone(bad)).toBeUndefined();
    }
  });

  it("keeps UTC days for the flag-off path", () => {
    expect(UTC_CALENDAR.dayOf(at("2026-10-20T23:59:59.999Z"))).toBe("2026-10-20");
    expect(UTC_CALENDAR.nextDayAt(at("2026-10-20T10:00:00.000Z"))).toBe(at("2026-10-21T00:00:00.000Z"));
  });
});

describe("changeZone (CC-146)", () => {
  const first = changeZone({ record: undefined, zone: "America/New_York", now: at("2026-10-21T10:00:00Z") });

  it("allows one change in 7 days", () => {
    expect(first.outcome).toBe("changed");
    const record = first.outcome === "changed" ? first.record : undefined;
    const soon = changeZone({ record, zone: "Europe/London", now: at("2026-10-27T10:00:00Z") });
    expect(soon).toEqual({
      outcome: "locked",
      changeableAt: at("2026-10-21T10:00:00Z") + ZONE_CHANGE_LOCK_MS,
    });
    const later = changeZone({ record, zone: "Europe/London", now: at("2026-10-28T10:00:00Z") });
    expect(later.outcome).toBe("changed");
    expect(changeZone({ record, zone: "America/New_York", now: at("2026-10-22T10:00:00Z") })).toEqual({
      outcome: "same",
      record,
    });
  });

  it("starts no lock when the browser says the zone already in use", () => {
    expect(changeZone({ record: undefined, zone: DEFAULT_ZONE, now: at("2026-10-21T10:00:00Z") })).toEqual({
      outcome: "same",
      record: undefined,
    });
  });

  it("a change west never repeats a day", () => {
    // India, 23:00 on 21 October (17:30 UTC), moves to New York, where it is still 13:30 on the 21st.
    const moved = changeZone({
      record: undefined,
      zone: "America/New_York",
      now: at("2026-10-21T17:30:00Z"),
    });
    const calendar = zoneCalendar(moved.outcome === "changed" ? moved.record : undefined);
    expect(daysSeen(calendar, "2026-10-21T17:30:00Z", 72)).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
    ]);
    // India's midnight ends the 21st; the 22nd lasts until New York's midnight after it.
    expect(calendar.nextDayAt(at("2026-10-21T17:30:00Z"))).toBe(at("2026-10-21T18:30:00Z"));
    expect(calendar.dayOf(at("2026-10-21T18:30:00Z"))).toBe("2026-10-22");
    expect(calendar.nextDayAt(at("2026-10-21T18:30:00Z"))).toBe(at("2026-10-23T04:00:00Z"));
  });

  it("a change east never skips a day", () => {
    const inNewYork = changeZone({
      record: undefined,
      zone: "America/New_York",
      now: at("2026-10-01T12:00:00Z"),
    });
    const record = inNewYork.outcome === "changed" ? inNewYork.record : undefined;
    // New York, 20:00 on 21 October (00:00 UTC on the 22nd), moves to Tokyo, where it is already 09:00 on the 22nd.
    const moved = changeZone({ record, zone: "Asia/Tokyo", now: at("2026-10-22T00:00:00Z") });
    const calendar = zoneCalendar(moved.outcome === "changed" ? moved.record : undefined);
    expect(daysSeen(calendar, "2026-10-22T00:00:00Z", 72)).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(calendar.nextDayAt(at("2026-10-22T00:00:00Z"))).toBe(at("2026-10-22T04:00:00Z"));
  });
});
