import { describe, expect, it } from "vitest";
import { FRIEND_RULES } from "@classicade/shared";
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
      expect(mayReach({ met, bothAdults: false })).toBe(true);
      expect(mayReach({ met, bothAdults: true })).toBe(true);
    }
  });

  it("lets a quick match stranger ask only when both are surely adults", () => {
    expect(mayReach({ met: MET_THROUGH.QUICK_MATCH, bothAdults: true })).toBe(true);
    expect(mayReach({ met: MET_THROUGH.QUICK_MATCH, bothAdults: false })).toBe(false);
  });
});
