import { describe, expect, it } from "vitest";
import { clockTime } from "./clockTime.js";

describe("clockTime (CC-146)", () => {
  it("says a reset as the clock time of the zone it is read in", () => {
    const indiaMidnight = Date.parse("2026-10-21T18:30:00Z");
    expect(clockTime(indiaMidnight, "Asia/Kolkata")).toMatch(/^12:00\s?am$/i);
    expect(clockTime(indiaMidnight, "America/New_York")).toMatch(/^2:30\s?pm$/i);
  });
});
