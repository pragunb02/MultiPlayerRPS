import { describe, expect, it } from "vitest";
import {
  REPORT_ACTIONS,
  REPORT_KEEP_DAYS,
  SUSPENDED_REASON,
  SUSPENSION_DURATION,
  SUSPENSION_DURATION_MS,
  SUSPENSION_DURATIONS,
  SUSPENSION_KEEP_DAYS,
  SUSPENSION_REASON,
  SUSPENSION_REASONS,
  SUSPENSION_REPORT_ACTION,
} from "./index.js";

const HOUR_MS = 60 * 60 * 1000;

describe("suspension names shared by the console, the sign-in page and the server (CC-334, ADR-078)", () => {
  it("offers 24 hours, 7 days, 30 days and until lifted, shortest first", () => {
    expect(SUSPENSION_DURATIONS).toEqual(["24h", "7d", "30d", "until-lifted"]);
    expect(SUSPENSION_DURATION_MS).toEqual({
      [SUSPENSION_DURATION.DAY]: 24 * HOUR_MS,
      [SUSPENSION_DURATION.WEEK]: 7 * 24 * HOUR_MS,
      [SUSPENSION_DURATION.MONTH]: 30 * 24 * HOUR_MS,
    });
    expect(SUSPENSION_DURATION_MS[SUSPENSION_DURATION.UNTIL_LIFTED]).toBeUndefined();
  });

  it("names a closed list of reasons, with no free text", () => {
    expect(SUSPENSION_REASONS).toEqual(["cheating", "harassment", "name", "other"]);
    expect(SUSPENSION_REASON.OTHER).toBe("other");
  });

  it("keeps a suspension 180 days after it ends, as long as a report, and closes reports as its own action", () => {
    expect(SUSPENSION_KEEP_DAYS).toBe(REPORT_KEEP_DAYS);
    expect(SUSPENSION_REPORT_ACTION).toBe("suspend");
    // The report console's own actions do not take it: a suspension needs a duration and a reason.
    expect(REPORT_ACTIONS).not.toContain(SUSPENSION_REPORT_ACTION);
    expect(SUSPENDED_REASON).toBe("suspended");
  });

  it("is frozen", () => {
    const lists = [
      SUSPENSION_DURATION,
      SUSPENSION_DURATIONS,
      SUSPENSION_DURATION_MS,
      SUSPENSION_REASON,
      SUSPENSION_REASONS,
    ];
    for (const value of lists) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
