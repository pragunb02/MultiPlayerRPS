import { describe, expect, it } from "vitest";
import { calendarVersion, isCalendarVersionOf, parseCommit, UNKNOWN_BUILD } from "./index.js";

const SHA = "a40ce5b9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f";

describe("parseCommit: only a commit sha is ever shown (CC-303)", () => {
  it.each([SHA, "a40ce5b"])("takes %s", (commit) => {
    expect(parseCommit(commit)).toBe(commit);
  });

  it.each([
    ["nothing", undefined],
    ["an empty value", ""],
    ["six characters", "a40ce5"],
    ["41 characters", `${SHA}0`],
    ["capitals", SHA.toUpperCase()],
    ["an email", "someone@example.com"],
    ["a sha with more after it", `${SHA}\nSECRET=x`],
    ["not text", 42],
  ])("says unknown for %s", (_, commit) => {
    expect(parseCommit(commit)).toBe(UNKNOWN_BUILD);
  });
});

describe("calendarVersion: the commit's UTC day and its short sha (owner, 2026-10-20)", () => {
  it("is the day the commit was made, in UTC, and the first 7 characters of the sha", () => {
    expect(calendarVersion({ commit: SHA, committedAt: "2026-10-20T18:30:00Z" })).toBe("2026.10.20+a40ce5b");
  });

  it("takes the UTC day even when git gives another time zone", () => {
    expect(calendarVersion({ commit: SHA, committedAt: "2026-10-21T02:00:00+05:30" })).toBe(
      "2026.10.20+a40ce5b",
    );
  });

  it("is the same every time for the same commit", () => {
    const once = calendarVersion({ commit: SHA, committedAt: "2026-01-02T00:00:00Z" });

    expect(calendarVersion({ commit: SHA, committedAt: "2026-01-02T00:00:00Z" })).toBe(once);
    expect(once).toBe("2026.01.02+a40ce5b");
  });

  it.each([
    ["an unknown commit", { commit: UNKNOWN_BUILD, committedAt: "2026-10-20T18:30:00Z" }],
    ["a date that is not one", { commit: SHA, committedAt: "yesterday" }],
    ["no date", { commit: SHA, committedAt: "" }],
  ])("says unknown for %s", (_, input) => {
    expect(calendarVersion(input)).toBe(UNKNOWN_BUILD);
  });
});

describe("isCalendarVersionOf: a version belongs to the commit it names", () => {
  it("takes the version of that commit", () => {
    expect(isCalendarVersionOf("2026.10.20+a40ce5b", SHA)).toBe(true);
  });

  it.each([
    ["another commit's version", "2026.10.20+bbbbbbb"],
    ["a version of another shape", "1.0.0"],
    ["a version with something after it", "2026.10.20+a40ce5b<script>"],
    ["not text", 7],
  ])("refuses %s", (_, version) => {
    expect(isCalendarVersionOf(version, SHA)).toBe(false);
  });
});
