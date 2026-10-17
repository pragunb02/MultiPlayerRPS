import { describe, expect, it } from "vitest";
import {
  addDays,
  bucketOf,
  bucketsOf,
  dayOf,
  daysBetween,
  daysOf,
  isDay,
  startOfDay,
  weekOf,
} from "./indiaTime.js";

describe("India days", () => {
  it("starts a day at 18:30 UTC the evening before", () => {
    expect(dayOf(Date.parse("2026-10-16T18:29:59.999Z"))).toBe("2026-10-16");
    expect(dayOf(Date.parse("2026-10-16T18:30:00.000Z"))).toBe("2026-10-17");
    expect(startOfDay("2026-10-17")).toBe(Date.parse("2026-10-16T18:30:00.000Z"));
  });

  it("knows real calendar days from look-alikes", () => {
    expect(isDay("2026-10-17")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2026-10-32")).toBe(false);
    expect(isDay("2026-10-7")).toBe(false);
    expect(isDay(20261017)).toBe(false);
  });

  it("counts days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-12-25", "2027-01-01")).toBe(7);
    expect(daysBetween("2026-10-02", "2026-10-01")).toBe(-1);
    expect(daysOf({ from: "2026-10-30", to: "2026-11-01" })).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  it("starts weeks on Monday", () => {
    expect(weekOf("2026-10-12")).toBe("2026-10-12");
    expect(weekOf("2026-10-18")).toBe("2026-10-12");
    expect(weekOf("2027-01-01")).toBe("2026-12-28");
  });

  it("names a day's bucket and lists the buckets of a range", () => {
    expect(bucketOf("2026-10-17", "day")).toBe("2026-10-17");
    expect(bucketOf("2026-10-17", "week")).toBe("2026-10-12");
    expect(bucketOf("2026-10-17", "month")).toBe("2026-10");
    expect(bucketsOf({ from: "2026-09-28", to: "2026-10-12", bucket: "week" })).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
    ]);
    expect(bucketsOf({ from: "2026-09-30", to: "2026-10-01", bucket: "month" })).toEqual([
      "2026-09",
      "2026-10",
    ]);
  });
});
