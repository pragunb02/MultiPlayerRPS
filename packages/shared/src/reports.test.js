import { describe, expect, it } from "vitest";
import {
  FEEDBACK_KEEP_DAYS,
  REPORT_ACTION,
  REPORT_ACTIONS,
  REPORT_CONTEXT,
  REPORT_KEEP_DAYS,
  REPORT_NOTE_MAX,
  REPORT_REASON,
  REPORT_REASONS,
  REPORT_STATUS,
  REPORT_STATUSES,
} from "./index.js";

describe("report names shared by the page and the server (CC-044, ADR-071)", () => {
  it("names the four closed reasons, in the order the dialog shows them", () => {
    expect(REPORT_REASON).toEqual({
      NAME: "name",
      CHEATING: "cheating",
      HARASSMENT: "harassment",
      OTHER: "other",
    });
    expect(REPORT_REASONS).toEqual(["name", "cheating", "harassment", "other"]);
  });

  it("names where a report comes from, its statuses and the console's actions", () => {
    expect(REPORT_CONTEXT).toEqual({ ROOM: "room", MATCH: "match", PROFILE: "profile" });
    expect(REPORT_STATUS).toEqual({ OPEN: "open", DISMISSED: "dismissed", ACTIONED: "actioned" });
    expect(REPORT_STATUSES).toEqual(Object.values(REPORT_STATUS));
    expect(REPORT_ACTION).toEqual({ DISMISS: "dismiss", RENAME: "rename" });
    expect(REPORT_ACTIONS).toEqual(Object.values(REPORT_ACTION));
  });

  it("keeps a note to 500 characters and a report for 180 days, as long as feedback", () => {
    expect(REPORT_NOTE_MAX).toBe(500);
    expect(REPORT_KEEP_DAYS).toBe(180);
    expect(REPORT_KEEP_DAYS).toBe(FEEDBACK_KEEP_DAYS);
  });

  it("is frozen, so no page or route can change a list", () => {
    for (const value of [REPORT_REASON, REPORT_REASONS, REPORT_CONTEXT, REPORT_STATUS, REPORT_ACTION]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
