import { describe, expect, it } from "vitest";
import { ValidationError } from "../utils/errors.js";
import { createAnalyticsRange, MAX_RANGE_DAYS } from "./analyticsRange.js";
import { addDays } from "../utils/indiaTime.js";

describe("createAnalyticsRange", () => {
  it("accepts a forward range of real days and a known bucket", () => {
    const range = createAnalyticsRange({ from: "2026-10-01", to: "2026-10-01", bucket: "week" });

    expect(range).toEqual({ from: "2026-10-01", to: "2026-10-01", bucket: "week" });
    expect(Object.isFrozen(range)).toBe(true);
  });

  it.each([
    [{ from: "2026-10-32", to: "2026-11-01", bucket: "day" }, "from"],
    [{ from: "2026-10-01", to: ["2026-10-02"], bucket: "day" }, "to"],
    [{ from: "2026-10-02", to: "2026-10-01", bucket: "day" }, "to"],
    [{ from: "2026-10-01", to: addDays("2026-10-01", MAX_RANGE_DAYS), bucket: "day" }, "to"],
    [{ from: "2026-10-01", to: "2026-10-02", bucket: "year" }, "bucket"],
  ])("refuses %j", (fields, field) => {
    expect(() => createAnalyticsRange(fields)).toThrow(ValidationError);
    try {
      createAnalyticsRange(fields);
    } catch (err) {
      expect(err.details.field).toBe(field);
    }
  });

  it("accepts the longest range", () => {
    const to = addDays("2026-01-01", MAX_RANGE_DAYS - 1);

    expect(createAnalyticsRange({ from: "2026-01-01", to, bucket: "month" }).to).toBe(to);
  });
});
