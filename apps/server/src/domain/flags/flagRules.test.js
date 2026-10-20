import { describe, expect, it } from "vitest";
import { FLAG_AUDIENCES } from "@classicade/shared";
import { createKeyedIds } from "../../utils/keyedIds.js";
import { BUCKETS, bucketFrom, inAudience, inRollout } from "./flagRules.js";

// Who gets a feature flag (CC-312, ADR-073): a keyed bucket per flag and player, and the audience.
const keyedIds = createKeyedIds({ secret: "a test key for feature flag buckets, 32+ chars" });
const bucketOf = (flag, playerId) => bucketFrom(keyedIds.idOf([flag, playerId]));
const players = Array.from({ length: 2000 }, (_, index) => `guest_${index}`);
const onAt = (flag, rollout) =>
  new Set(players.filter((id) => inRollout({ rollout, bucket: bucketOf(flag, id) })));

describe("flag buckets (CC-312)", () => {
  it("gives the same player the same bucket for a flag every time, between 0 and 9 999", () => {
    const bucket = bucketOf("new_lobby", "guest_1");

    expect(bucketOf("new_lobby", "guest_1")).toBe(bucket);
    expect(Number.isInteger(bucket)).toBe(true);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(BUCKETS);
  });

  it("gives each flag its own buckets, so two experiments do not pick the same players", () => {
    const first = onAt("new_lobby", 50);
    const second = onAt("new_board", 50);
    const both = [...first].filter((id) => second.has(id)).length;

    // Independent halves overlap by about a quarter of everyone.
    expect(both / players.length).toBeGreaterThan(0.2);
    expect(both / players.length).toBeLessThan(0.3);
  });

  it("a ramp only adds players: everyone on at 10 % is still on at 50 %, and going back gives the same 10 %", () => {
    const ten = onAt("new_lobby", 10);
    const fifty = onAt("new_lobby", 50);

    expect([...ten].every((id) => fifty.has(id))).toBe(true);
    expect(onAt("new_lobby", 10)).toEqual(ten);
  });

  it("puts close to the asked share of players on", () => {
    expect(onAt("new_lobby", 10).size / players.length).toBeCloseTo(0.1, 1);
    expect(onAt("new_lobby", 50).size / players.length).toBeCloseTo(0.5, 1);
  });

  it.each([
    ["off", 0, false],
    ["on", 9999, true],
    [0, 0, false],
    [100, 9999, true],
    [1, 99, true],
    [1, 100, false],
  ])("rollout %j at bucket %i is on: %s", (rollout, bucket, on) => {
    expect(inRollout({ rollout, bucket })).toBe(on);
  });

  it("a visitor with no bucket gets a flag only when it is on for everyone", () => {
    expect(inRollout({ rollout: "on", bucket: undefined })).toBe(true);
    expect(inRollout({ rollout: 99, bucket: undefined })).toBe(false);
    expect(inRollout({ rollout: "off", bucket: undefined })).toBe(false);
  });
});

describe("flag audiences (CC-312)", () => {
  const VISITOR = undefined;
  const GUEST = { id: "guest_1", kind: "guest", admin: false };
  const ACCOUNT = { id: "user_1", kind: "user", admin: false };
  const ADMIN = { id: "user_2", kind: "user", admin: true };

  it.each([
    [FLAG_AUDIENCES.EVERYONE, VISITOR, false, true],
    [FLAG_AUDIENCES.EVERYONE, GUEST, false, true],
    [FLAG_AUDIENCES.SIGNED_IN, VISITOR, false, false],
    [FLAG_AUDIENCES.SIGNED_IN, GUEST, false, false],
    [FLAG_AUDIENCES.SIGNED_IN, ACCOUNT, false, true],
    [FLAG_AUDIENCES.ADULTS, GUEST, false, false],
    [FLAG_AUDIENCES.ADULTS, ACCOUNT, false, false],
    [FLAG_AUDIENCES.ADULTS, ACCOUNT, true, true],
    [FLAG_AUDIENCES.ADMINS, ACCOUNT, true, false],
    [FLAG_AUDIENCES.ADMINS, ADMIN, false, true],
    [FLAG_AUDIENCES.ADMINS, VISITOR, false, false],
  ])(
    "a player outside the audience never gets the flag: %s, %j, adult %s, in %s",
    (audience, player, adult, inside) => {
      expect(inAudience({ audience, player, adult })).toBe(inside);
    },
  );

  it("refuses an audience it does not know, rather than letting everyone in", () => {
    expect(() => inAudience({ audience: "friends", player: GUEST, adult: false })).toThrow(RangeError);
  });
});
