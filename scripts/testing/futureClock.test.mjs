import { describe, expect, it } from "vitest";
import { futureDays, shiftedDate } from "./futureClock.mjs";

describe("the time-bomb check's clock (CC-325)", () => {
  it("reads the days ahead, and nothing when they are not set", () => {
    expect(futureDays(undefined)).toBe(0);
    expect(futureDays("")).toBe(0);
    expect(futureDays("365")).toBe(365);
    for (const bad of ["-1", "1.5", "soon"]) {
      expect(() => futureDays(bad)).toThrow(RangeError);
    }
  });

  it("moves now and a new date ahead, and leaves a date built from a value alone", () => {
    const FutureDate = shiftedDate(Date, 30 * 86_400_000);
    const before = Date.now();

    expect(FutureDate.now() - before).toBeGreaterThanOrEqual(30 * 86_400_000);
    expect(new FutureDate().getTime() - before).toBeGreaterThanOrEqual(30 * 86_400_000);
    expect(new FutureDate(0).getTime()).toBe(0);
    expect(new FutureDate("2026-10-20T00:00:00Z").toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(new FutureDate() instanceof Date).toBe(true);
    expect(FutureDate.name).toBe("Date");
    expect(FutureDate.UTC(2026, 9, 20)).toBe(Date.UTC(2026, 9, 20));
    expect(Date.parse(FutureDate())).toBeGreaterThanOrEqual(before + 29 * 86_400_000);
  });
});
