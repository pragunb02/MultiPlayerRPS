import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFeedbackComponent } from "../feedback/feedbackComponent.js";
import { createLeaderboardComponent } from "../leaderboards/leaderboardComponent.js";
import { createProfileCards } from "../profiles/profileCards.js";
import { createProfileComponent } from "../profiles/profileComponent.js";

const SERVER_SRC = fileURLToPath(new URL("../..", import.meta.url));

/** Every module of the server that is not a test. */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "testing" ? [] : sourceFiles(path);
    return entry.name.endsWith(".js") && !entry.name.includes(".test.") ? [path] : [];
  });
}

// The words that work an age out. Only the account component (which reads the years) and the safety component
// (which turns them into policies) may use them. Every feature asks the policy instead (CC-152).
const AGE_WORDS = /\b(ageGroupFor|AGE_GROUPS|adultsAmong|ageGroupsOf)\b/;
const MAY_WORK_OUT_AGES = new Set([
  "domain/accounts/accountComponent.js",
  "domain/safety/agePolicy.js",
  "domain/safety/safetyComponent.js",
]);

describe("the age policy is the one place for the under 18 defaults (CC-152)", () => {
  it("no server module outside accounts and safety works an age out itself", () => {
    const offenders = sourceFiles(SERVER_SRC)
      .map((path) => relative(SERVER_SRC, path).split("\\").join("/"))
      .filter((path) => !MAY_WORK_OUT_AGES.has(path))
      .filter((path) => AGE_WORDS.test(readFileSync(join(SERVER_SRC, path), "utf8")));

    expect(offenders).toEqual([]);
  });

  // Each feature that exists today refuses to be made without the safety component, so none can run on its own
  // idea of a player's age. Friends (CC-052), emotes (CC-169), circles (CC-214) and notifications (CC-147) join
  // this list when they are built.
  it.each([
    [
      "profiles (CC-034)",
      () =>
        createProfileComponent({
          profileAccessor: {},
          accounts: { profileOf() {} },
          progress: { getProgress() {} },
          ratings: { ratingsOf() {} },
        }),
    ],
    [
      "profile cards on boards, rooms and history (CC-034)",
      () => createProfileCards({ profileAccessor: {} }),
    ],
    [
      "leaderboards (ADR-048.10)",
      () =>
        createLeaderboardComponent({
          leaderboardAccessor: {},
          matchAccessor: {},
          progressAccessor: {},
          transfers: { listFrom() {}, listPendingTo() {} },
        }),
    ],
    ["feedback replies (CC-290, ADR-059)", () => createFeedbackComponent({ feedbackAccessor: {} })],
  ])("%s cannot be made without the safety component", (_feature, make) => {
    expect(make).toThrow(/safety\.(policiesFor|policyFor)/);
  });
});
