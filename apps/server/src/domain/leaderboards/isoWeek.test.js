import { describe, expect, it } from "vitest";
import { isoWeek } from "./isoWeek.js";

const at = (iso) => Date.parse(iso);

describe("isoWeek", () => {
  it.each([
    ["2026-10-16T12:00:00Z", "2026-W42"],
    ["2026-01-01T00:00:00Z", "2026-W01"], // a Thursday: week 1 of its own year
    ["2025-12-29T00:00:00Z", "2026-W01"], // Monday before: already 2026's week 1
    ["2025-12-28T23:59:59.999Z", "2025-W52"],
    ["2026-12-31T12:00:00Z", "2026-W53"], // 2026 has 53 weeks
    ["2027-01-01T00:00:00Z", "2026-W53"], // a Friday: still 2026's last week
    ["2027-01-03T23:59:59.999Z", "2026-W53"],
    ["2027-01-04T00:00:00Z", "2027-W01"],
    ["2021-01-03T12:00:00Z", "2020-W53"],
  ])("puts %s in %s", (iso, id) => {
    expect(isoWeek(at(iso)).id).toBe(id);
  });

  it("starts on Monday 00:00 UTC and lasts exactly a week", () => {
    const week = isoWeek(at("2026-10-16T12:00:00Z"));

    expect(week.startsAt).toBe(at("2026-10-12T00:00:00Z"));
    expect(week.endsAt).toBe(at("2026-10-19T00:00:00Z"));
    expect(Object.isFrozen(week)).toBe(true);
  });

  it("rolls over at Monday midnight UTC", () => {
    expect(isoWeek(at("2026-10-18T23:59:59.999Z")).id).toBe("2026-W42");
    expect(isoWeek(at("2026-10-19T00:00:00Z")).id).toBe("2026-W43");
  });

  it.each([[NaN], [Infinity], ["2026"]])("refuses %o", (value) => {
    expect(() => isoWeek(/** @type {any} */ (value))).toThrow(RangeError);
  });
});
