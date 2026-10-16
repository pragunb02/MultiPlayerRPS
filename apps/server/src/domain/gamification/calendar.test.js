import { describe, expect, it } from "vitest";
import { addDays, nextUtcMidnight, startOfUtcDay, utcDay } from "./calendar.js";

const ms = (iso) => Date.parse(iso);

describe("calendar (UTC days)", () => {
  it.each([
    ["2026-10-16T23:59:59.999Z", "2026-10-16"],
    ["2026-10-17T00:00:00.000Z", "2026-10-17"],
    ["2026-12-31T23:30:00.000Z", "2026-12-31"],
  ])("%s is on %s", (iso, day) => {
    expect(utcDay(ms(iso))).toBe(day);
  });

  it("finds the next midnight: one millisecond before it, and exactly at it (a new day)", () => {
    expect(nextUtcMidnight(ms("2026-10-16T23:59:59.999Z"))).toBe(ms("2026-10-17T00:00:00.000Z"));
    expect(nextUtcMidnight(ms("2026-10-17T00:00:00.000Z"))).toBe(ms("2026-10-18T00:00:00.000Z"));
  });

  it("adds and subtracts days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(startOfUtcDay("2026-10-16")).toBe(ms("2026-10-16T00:00:00.000Z"));
  });
});
