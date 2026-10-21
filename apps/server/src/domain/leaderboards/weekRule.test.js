import { describe, expect, it } from "vitest";
import { createFeatureFlagAccessor } from "../../data/featureFlagAccessor.js";
import { captureLogger } from "../../testing/captureLogger.js";
import { createInMemoryFeatureFlagDao } from "../../testing/inMemoryFeatureFlagDao.js";
import { createKeyedIds } from "../../utils/keyedIds.js";
import { createFlagComponent } from "../flags/flagComponent.js";
import { INDIA_WEEK_OFFSET_MS } from "./isoWeek.js";
import { createWeekRule } from "./weekRule.js";

// The weekly boards' week (CC-146, ADR-015 amended): UTC until local_days is on for everyone, then India time for
// good. A fixed clock: nothing here reads the real time (CC-325).
const T0 = Date.UTC(2026, 9, 21, 10);

function setup() {
  const flags = createFlagComponent({
    flagAccessor: createFeatureFlagAccessor({ featureFlagDao: createInMemoryFeatureFlagDao() }),
    keyedIds: createKeyedIds({ secret: Buffer.alloc(32, 7) }),
    safety: { policyFor: async () => ({ audience: "unknown" }) },
    logger: captureLogger().logger,
    now: () => T0,
  });
  return { flags, weekOffset: createWeekRule({ flags }) };
}

const localDaysCounts = async (flags) =>
  (await flags.overview()).flags.find(({ name }) => name === "local_days").counts;

describe("the weekly boards' week rule (CC-146)", () => {
  it("is UTC until local_days is fully on, and board reads count no exposure", async () => {
    const { flags, weekOffset } = setup();
    const before = await localDaysCounts(flags);
    expect(await weekOffset()).toBe(0);
    await flags.setRollout({ name: "local_days", rollout: 50 });
    for (let read = 0; read < 10; read++) {
      expect(await weekOffset()).toBe(0);
    }
    await flags.setRollout({ name: "local_days", rollout: "on" });
    expect(await weekOffset()).toBe(INDIA_WEEK_OFFSET_MS);
    expect(await localDaysCounts(flags)).toEqual(before);
  });

  it("stays on India weeks once switched, so a rollback never shows a week twice", async () => {
    const { flags, weekOffset } = setup();
    await flags.setRollout({ name: "local_days", rollout: "on" });
    expect(await weekOffset()).toBe(INDIA_WEEK_OFFSET_MS);
    await flags.setRollout({ name: "local_days", rollout: "off" });
    expect(await weekOffset()).toBe(INDIA_WEEK_OFFSET_MS);
  });
});
