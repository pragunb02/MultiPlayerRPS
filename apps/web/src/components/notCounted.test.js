import { NOT_COUNTED_REASONS } from "@classicade/shared";
import { describe, expect, it } from "vitest";
import { isUncountedMatch, notCountedMessage } from "./notCounted.js";

describe("notCountedMessage", () => {
  it.each([
    [NOT_COUNTED_REASONS.ENDED_TOO_SOON, "This game didn't count: it ended too soon"],
    [
      NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT,
      "This game didn't count: daily limit with this opponent reached",
    ],
    [
      NOT_COUNTED_REASONS.HOURLY_LIMIT,
      "This game didn't count: you reached the limit of counted games this hour",
    ],
  ])("explains %s", (reason, message) => {
    expect(notCountedMessage(reason)).toBe(message);
  });

  it("still says the game didn't count for a reason it doesn't know", () => {
    expect(notCountedMessage("some-new-reason")).toBe("This game didn't count");
  });
});

describe("isUncountedMatch", () => {
  it.each([
    [{ source: "match", counted: false }, true],
    [{ source: "match", counted: true }, false],
    [{ source: "match" }, false],
    [{ source: "quest", counted: false }, false],
  ])("tells %o apart", (update, expected) => {
    expect(isUncountedMatch(update)).toBe(expected);
  });
});
