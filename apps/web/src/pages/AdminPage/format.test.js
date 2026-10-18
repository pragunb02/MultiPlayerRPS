import { describe, expect, it } from "vitest";
import {
  addDays,
  boardName,
  csvValue,
  drawable,
  formatChange,
  formatCount,
  formatDecimal,
  formatSeconds,
  formatShare,
  gameName,
  indiaToday,
} from "./format.js";

describe("owner console formats", () => {
  it("writes hidden groups as fewer than 5 everywhere", () => {
    for (const format of [formatCount, formatShare, formatSeconds, formatDecimal, csvValue]) {
      expect(format("<5")).toBe("fewer than 5");
    }
    expect(drawable("<5")).toBe(0);
  });

  it("writes a total whose data was removed as no longer kept, on screen and in files", () => {
    expect(formatCount("not kept")).toBe("no longer kept");
    expect(csvValue("not kept")).toBe("no longer kept");
  });

  it("writes a count the server could not see in full as not counted, on screen and in files", () => {
    expect(formatCount("not counted")).toBe("not counted");
    expect(csvValue("not counted")).toBe("not counted");
    expect(drawable("not counted")).toBe(0);
  });

  it("writes counts, shares, lengths and decimals for people", () => {
    expect(formatCount(123456)).toBe("1,23,456");
    expect(formatShare(0.4545)).toBe("45.5%");
    expect(formatSeconds(45)).toBe("45 s");
    expect(formatSeconds(200)).toBe("3 min 20 s");
    expect(formatDecimal(2.625)).toBe("2.63");
    expect(csvValue(7)).toBe(7);
  });

  it("writes changes with a sign, and words where there is no share", () => {
    expect(formatChange(0.12)).toBe("+12.0%");
    expect(formatChange(-0.05)).toBe("−5.0%");
    expect(formatChange(0)).toBe("no change");
    expect(formatChange("new")).toBe("new");
    expect(formatChange("hidden")).toBe("");
  });

  it("names games and boards, keeping ids it does not know", () => {
    expect(gameName("chess")).toBe("Chess");
    expect(gameName("ludo")).toBe("ludo");
    expect(boardName("xp")).toBe("Overall XP");
    expect(boardName("wins:rps")).toBe("Rock Paper Scissors wins");
    expect(boardName("other")).toBe("other");
  });

  it("counts days in India time", () => {
    expect(indiaToday(Date.parse("2026-10-16T18:30:00.000Z"))).toBe("2026-10-17");
    expect(addDays("2026-10-17", -6)).toBe("2026-10-11");
  });
});
