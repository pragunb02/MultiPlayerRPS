import { describe, expect, it } from "vitest";
import { FRIEND_RULES } from "@classicade/shared";
import { FRIENDS_MODES } from "../safety/agePolicy.js";
import { FRIEND_LIMITS, mayReach, MET_THROUGH } from "./friendRules.js";

describe("friend rules (CC-052, ADR-066)", () => {
  it("takes the numbers players are told from the shared rules", () => {
    expect(FRIEND_LIMITS).toMatchObject({
      maxFriends: FRIEND_RULES.maxFriends,
      maxWaiting: FRIEND_RULES.maxWaiting,
      requestLifetimeMs: 30 * 24 * 60 * 60 * 1000,
      linkLifetimeMs: 7 * 24 * 60 * 60 * 1000,
      linksKept: 5,
      incomingShown: 50,
      ringAgainAfterMs: 15 * 60 * 1000,
    });
    expect(Object.isFrozen(FRIEND_LIMITS)).toBe(true);
  });

  it("lets anyone met through a link ask, adults or not (ADR-051.7)", () => {
    for (const met of [MET_THROUGH.LINK_ROOM, MET_THROUGH.FRIEND_LINK]) {
      expect(mayReach({ met, modes: [FRIENDS_MODES.MUTUAL_KNOWN, FRIENDS_MODES.MUTUAL] })).toBe(true);
      expect(mayReach({ met, modes: [FRIENDS_MODES.MUTUAL, FRIENDS_MODES.MUTUAL] })).toBe(true);
    }
  });

  it("lets a quick match stranger ask only when both may befriend anyone (the adults' policy)", () => {
    expect(
      mayReach({ met: MET_THROUGH.QUICK_MATCH, modes: [FRIENDS_MODES.MUTUAL, FRIENDS_MODES.MUTUAL] }),
    ).toBe(true);
    expect(
      mayReach({ met: MET_THROUGH.QUICK_MATCH, modes: [FRIENDS_MODES.MUTUAL, FRIENDS_MODES.MUTUAL_KNOWN] }),
    ).toBe(false);
  });
});
