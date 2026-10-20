import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIENCES, agePolicyFor, clientPolicyOf } from "./agePolicy.js";
import { createFeedbackComponent } from "../feedback/feedbackComponent.js";
import { createFriendComponent } from "../friends/friendComponent.js";
import { createLeaderboardComponent } from "../leaderboards/leaderboardComponent.js";
import { createProfileCards } from "../profiles/profileCards.js";
import { createProfileComponent } from "../profiles/profileComponent.js";

const SERVER_SRC = fileURLToPath(new URL("../..", import.meta.url));
const WEB_SRC = fileURLToPath(new URL("../../../../web/src", import.meta.url));

/** Every module under `dir` that is not a test or a test helper. */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "testing" ? [] : sourceFiles(path);
    return /\.jsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

/** The modules under `root` whose text matches `words`, as paths from `root`. */
const usersOf = (root, words) =>
  sourceFiles(root)
    .map((path) => relative(root, path).split("\\").join("/"))
    .filter((path) => words.test(readFileSync(join(root, path), "utf8")));

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
    const offenders = usersOf(SERVER_SRC, AGE_WORDS).filter((path) => !MAY_WORK_OUT_AGES.has(path));

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
    [
      "friends (CC-052)",
      () =>
        createFriendComponent({
          friendAccessor: {},
          privacyAccessor: {},
          profiles: { getOrCreateMany() {}, getByHandle() {} },
          coPlayers: { personAt() {} },
          blocks: { blockedWith() {} },
          accounts: { usernamesOf() {} },
        }),
    ],
  ])("%s cannot be made without the safety component", (_feature, make) => {
    expect(make).toThrow(/safety\.(policiesFor|policyFor)/);
  });
});

describe("the browser reads the policy's flags, never an age (CC-152)", () => {
  it("no web module works out an age group or decides by one", () => {
    // The owner console only shows the owner what a correction made of an account. It decides nothing by it.
    expect(usersOf(WEB_SRC, /\b(ageGroup|ageGroupFor|AGE_GROUPS)\b/)).toEqual([
      "pages/AdminPage/AgeCorrections.jsx",
    ]);
  });

  // The features in the browser the policy covers today: share cards (CC-217) and the profile's privacy part.
  it("share cards and the profile read the flags through useSafety, and nothing else does it another way", () => {
    expect(usersOf(WEB_SRC, /= useSafety\(\)/)).toEqual([
      "components/ShareResult/ShareResult.jsx",
      "pages/ProfilePage/PrivacySettings.jsx",
    ]);
    expect(usersOf(WEB_SRC, /["']\/safety["']/)).toEqual(["lib/api.js"]);
  });

  it("assumes exactly the server's flags for an account of unknown age while it waits", async () => {
    const { SAFEST_FLAGS } = await import("../../../../web/src/hooks/useSafety.js");

    expect(SAFEST_FLAGS).toEqual(clientPolicyOf(agePolicyFor(AUDIENCES.UNKNOWN)));
  });
});
