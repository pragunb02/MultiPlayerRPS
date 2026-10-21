import { describe, expect, it } from "vitest";
import { SUSPENSION_KEEP_DAYS } from "@classicade/shared";
import { createInMemorySuspensionDao } from "../testing/inMemorySuspensionDao.js";
import { NotFoundError } from "../utils/errors.js";
import { createSuspensionAccessor } from "./suspensionAccessor.js";

const HOUR_MS = 60 * 60 * 1000;
const KEEP_MS = SUSPENSION_KEEP_DAYS * 24 * HOUR_MS;
const T0 = Date.UTC(2026, 9, 21, 12);
const BOB = "user_0123456789abcdef01234567";
const RIYA = "user_ffffffffffffffffffffffff";
const OWNER = Object.freeze({ id: "user_aaaaaaaaaaaaaaaaaaaaaaaa", name: "Owner" });

let counter = 0;
const input = ({ playerId = BOB, startedAt = T0, untilLifted = false, ...rest } = {}) => {
  const endsAt = untilLifted ? undefined : (rest.endsAt ?? startedAt + 24 * HOUR_MS);
  return {
    suspensionId: `00000000-0000-4000-b000-${String(++counter).padStart(12, "0")}`,
    playerId,
    nameThen: "Bob",
    duration: endsAt === undefined ? "until-lifted" : "24h",
    reason: "harassment",
    by: OWNER,
    startedAt,
    ...rest,
    ...(endsAt !== undefined && { endsAt }),
  };
};

const setUp = () => {
  const dao = createInMemorySuspensionDao();
  return { dao, suspensions: createSuspensionAccessor({ suspensionDao: dao }) };
};

describe("suspensionAccessor (CC-334, ADR-078)", () => {
  it("stores a suspension and answers a frozen model with times in milliseconds", async () => {
    const { suspensions } = setUp();
    const given = input();

    const stored = await suspensions.add(given);

    const { by, ...fields } = given;
    expect(stored).toEqual({ ...fields, byId: OWNER.id, byName: OWNER.name });
    expect(Object.isFrozen(stored)).toBe(true);
    expect(await suspensions.get(given.suspensionId)).toEqual(stored);
  });

  it("keeps a timed suspension until 180 days after it ends, and one until lifted with no end at all", async () => {
    const { dao, suspensions } = setUp();
    const timed = await suspensions.add(input());
    const untilLifted = await suspensions.add(input({ untilLifted: true }));

    expect((await dao.getById(timed.suspensionId)).deleteAt).toEqual(new Date(timed.endsAt + KEEP_MS));
    expect((await dao.getById(untilLifted.suspensionId)).deleteAt).toBeUndefined();
    expect(untilLifted).not.toHaveProperty("endsAt");
  });

  it("lifts a suspension in effect, keeps it 180 days from the lift, and refuses a second lift", async () => {
    const { dao, suspensions } = setUp();
    const untilLifted = await suspensions.add(input({ untilLifted: true }));
    const at = T0 + 5 * HOUR_MS;

    expect(await suspensions.lift({ suspensionId: untilLifted.suspensionId, by: OWNER, at })).toBe(true);
    expect(await suspensions.lift({ suspensionId: untilLifted.suspensionId, by: OWNER, at })).toBe(false);

    expect(await suspensions.get(untilLifted.suspensionId)).toEqual({
      ...untilLifted,
      liftedAt: at,
      liftedById: OWNER.id,
      liftedByName: OWNER.name,
    });
    expect((await dao.getById(untilLifted.suspensionId)).deleteAt).toEqual(new Date(at + KEEP_MS));
  });

  it("answers the suspensions in effect, and the players they cover", async () => {
    const { suspensions } = setUp();
    await suspensions.add(input({ startedAt: T0, endsAt: T0 + HOUR_MS }));
    const riya = await suspensions.add(input({ playerId: RIYA, untilLifted: true }));

    const at = T0 + 2 * HOUR_MS;

    expect(await suspensions.listActive({ at })).toEqual([riya]);
    expect(await suspensions.activePlayerIds({ at })).toEqual(new Set([RIYA]));
    expect(await suspensions.activePlayerIds({ at: T0 })).toEqual(new Set([BOB, RIYA]));
  });

  it("lists one player's history newest first, and removes it all", async () => {
    const { suspensions } = setUp();
    const first = await suspensions.add(input({ startedAt: T0 }));
    const second = await suspensions.add(input({ startedAt: T0 + 48 * HOUR_MS, untilLifted: true }));

    expect(await suspensions.listByPlayer(BOB)).toEqual([second, first]);
    expect(await suspensions.removePlayer(BOB)).toBe(2);
    expect(await suspensions.listByPlayer(BOB)).toEqual([]);
  });

  it("answers NotFoundError for an unknown suspension", async () => {
    const { suspensions } = setUp();

    await expect(suspensions.get("00000000-0000-4000-b000-ffffffffffff")).rejects.toThrow(NotFoundError);
  });
});
