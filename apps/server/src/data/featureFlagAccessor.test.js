import { describe, expect, it } from "vitest";
import { createInMemoryFeatureFlagDao } from "../testing/inMemoryFeatureFlagDao.js";
import { createFeatureFlagAccessor } from "./featureFlagAccessor.js";

// CC-312: the domain sees overrides and counts with times in milliseconds.
const T0 = Date.UTC(2026, 9, 20, 12);

describe("feature flag accessor (CC-312)", () => {
  it("needs its DAO", () => {
    expect(() => createFeatureFlagAccessor({})).toThrow(/featureFlagDao/);
  });

  it("sets, lists and clears overrides with times in milliseconds", async () => {
    const accessor = createFeatureFlagAccessor({ featureFlagDao: createInMemoryFeatureFlagDao() });

    expect(await accessor.setOverride({ name: "new_lobby", rollout: 25, at: T0 })).toEqual({
      name: "new_lobby",
      rollout: 25,
      updatedAt: T0,
    });
    const listed = await accessor.listOverrides();
    expect(listed).toEqual([{ name: "new_lobby", rollout: 25, updatedAt: T0 }]);
    expect(Object.isFrozen(listed[0])).toBe(true);
    expect(await accessor.clearOverride("new_lobby")).toBe(true);
    expect(await accessor.clearOverride("new_lobby")).toBe(false);
  });

  it("adds counts with their expiry and sums them from a day on", async () => {
    const dao = createInMemoryFeatureFlagDao();
    const accessor = createFeatureFlagAccessor({ featureFlagDao: dao });

    await accessor.addCounts([
      { flag: "new_lobby", day: "2026-10-20", side: "on", exposures: 3, successes: 1, expiresAt: T0 },
    ]);

    expect(await accessor.countsSince("2026-10-01")).toEqual([
      { flag: "new_lobby", side: "on", exposures: 3, successes: 1 },
    ]);
  });
});
