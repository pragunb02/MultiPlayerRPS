import { describe, expect, it } from "vitest";
import { FIRST_DAY, INDIA_CALENDAR, scheduleOn } from "./schedule.js";

describe("the daily puzzle schedule", () => {
  it("starts on a Monday", () => {
    expect(new Date(`${FIRST_DAY}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("gives each day the next puzzle of the set, numbered from the first day", () => {
    expect(scheduleOn({ day: FIRST_DAY, count: 406 })).toEqual({ number: 1, index: 0 });
    expect(scheduleOn({ day: "2026-10-20", count: 406 })).toEqual({ number: 2, index: 1 });
  });

  it("starts the set again once every puzzle was played, on the same weekday", () => {
    const wrapped = scheduleOn({ day: "2027-11-30", count: 406 });

    expect(wrapped).toEqual({ number: 408, index: 1 });
    expect(new Date("2027-11-30T00:00:00Z").getUTCDay()).toBe(new Date("2026-10-20T00:00:00Z").getUTCDay());
  });

  it("has no puzzle before the first day or in an empty set", () => {
    expect(() => scheduleOn({ day: "2026-10-18", count: 406 })).toThrow(RangeError);
    expect(() => scheduleOn({ day: FIRST_DAY, count: 0 })).toThrow(RangeError);
  });

  it("turns the day at midnight in India", () => {
    const beforeMidnight = Date.UTC(2026, 9, 20, 18, 29);
    const afterMidnight = Date.UTC(2026, 9, 20, 18, 30);

    expect(INDIA_CALENDAR.dayOf(beforeMidnight)).toBe("2026-10-20");
    expect(INDIA_CALENDAR.dayOf(afterMidnight)).toBe("2026-10-21");
    expect(INDIA_CALENDAR.nextDayAt(beforeMidnight)).toBe(afterMidnight);
  });
});
