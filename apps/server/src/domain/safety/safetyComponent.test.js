import { describe, expect, it } from "vitest";
import { AUDIENCES, agePolicyFor } from "./agePolicy.js";
import { createSafetyComponent } from "./safetyComponent.js";

const NOW = Date.UTC(2026, 9, 20);
const ADULT = "user_aaaaaaaaaaaaaaaaaaaaaaaa";
const MINOR = "user_bbbbbbbbbbbbbbbbbbbbbbbb";
const NO_YEAR = "user_cccccccccccccccccccccccc";
const GUEST = "guest_8d1c7a2e-1f0b-4c3a-9f0e-2b7c5d6e4a1f";
const BOT = "bot_rocky_easy";

function setup() {
  const asked = [];
  const groups = new Map([
    [ADULT, "adult"],
    [MINOR, "minor"],
    [NO_YEAR, "unknown"],
  ]);
  const safety = createSafetyComponent({
    ages: {
      ageGroupsOf: async ({ playerIds, now }) => {
        asked.push({ playerIds, now });
        return new Map(playerIds.filter((id) => groups.has(id)).map((id) => [id, groups.get(id)]));
      },
    },
  });
  return { safety, asked };
}

describe("safetyComponent (CC-152): every feature's one reader of the age policy", () => {
  it("gives each player the policy of who they are, asking for the accounts' ages once", async () => {
    const { safety, asked } = setup();

    const policies = await safety.policiesFor({
      playerIds: [ADULT, MINOR, NO_YEAR, GUEST, BOT, ADULT],
      now: NOW,
    });

    expect(Object.fromEntries(policies)).toEqual({
      [ADULT]: agePolicyFor(AUDIENCES.ADULT),
      [MINOR]: agePolicyFor(AUDIENCES.MINOR),
      [NO_YEAR]: agePolicyFor(AUDIENCES.UNKNOWN),
      [GUEST]: agePolicyFor(AUDIENCES.GUEST),
      [BOT]: agePolicyFor(AUDIENCES.UNKNOWN),
    });
    expect(asked).toEqual([{ playerIds: [ADULT, MINOR, NO_YEAR], now: NOW }]);
  });

  it("asks nothing when no account is among the players, or no players at all", async () => {
    const { safety, asked } = setup();

    expect((await safety.policyFor({ playerId: GUEST, now: NOW })).audience).toBe(AUDIENCES.GUEST);
    expect(await safety.policiesFor({ playerIds: [], now: NOW })).toEqual(new Map());
    expect(asked).toEqual([]);
  });

  it("treats an account the ages do not know, such as a deleted one, as unknown, so a minor", async () => {
    const safety = createSafetyComponent({ ages: { ageGroupsOf: async () => new Map() } });

    expect(await safety.policyFor({ playerId: ADULT, now: NOW })).toBe(agePolicyFor(AUDIENCES.UNKNOWN));
  });

  it("checks its dependency when it is made", () => {
    expect(() => createSafetyComponent({ ages: {} })).toThrow(TypeError);
  });
});
