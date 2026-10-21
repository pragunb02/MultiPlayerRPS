import { expect, it } from "vitest";

const T0 = new Date(Date.UTC(2026, 9, 21, 12));
const at = (hours) => new Date(T0.getTime() + hours * 60 * 60 * 1000);
const BOB = "user_0123456789abcdef01234567";
const RIYA = "user_ffffffffffffffffffffffff";
const OWNER = "user_aaaaaaaaaaaaaaaaaaaaaaaa";

let counter = 0;
/** A suspension as the accessor writes it, with a fresh id unless one is given. */
const record = ({ playerId = BOB, startedAt = at(0), endsAt = at(24), suspensionId, ...rest } = {}) => ({
  suspensionId: suspensionId ?? `00000000-0000-4000-9000-${String(++counter).padStart(12, "0")}`,
  playerId,
  nameThen: "Bob",
  duration: "24h",
  reason: "harassment",
  startedAt,
  endsAt,
  byId: OWNER,
  byName: "Owner",
  ...(endsAt !== null && { deleteAt: new Date(endsAt.getTime() + 180 * 24 * 60 * 60 * 1000) }),
  ...rest,
});

/**
 * Behaviour every suspension DAO must have (CC-334, ADR-078): the MongoDB DAO and the in-memory double.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/suspensionDao.js").createSuspensionDao>>} createDao
 */
export function runSuspensionDaoContract(createDao) {
  it("stores a suspension and reads it back by its id, one until lifted too", async () => {
    const dao = await createDao();
    const timed = record();
    const untilLifted = record({ duration: "until-lifted", endsAt: null });

    expect(await dao.insert(timed)).toEqual(timed);
    expect(await dao.insert(untilLifted)).toEqual(untilLifted);

    expect(await dao.getById(timed.suspensionId)).toEqual(timed);
    expect(await dao.getById(untilLifted.suspensionId)).toEqual(untilLifted);
  });

  it("throws for an unknown id", async () => {
    const dao = await createDao();

    await expect(dao.getById("00000000-0000-4000-9000-ffffffffffff")).rejects.toThrow(RangeError);
  });

  it("lists one player's suspensions newest first, nobody else's", async () => {
    const dao = await createDao();
    const first = await dao.insert(record({ startedAt: at(0), endsAt: at(24) }));
    const second = await dao.insert(record({ startedAt: at(48), endsAt: at(72) }));
    await dao.insert(record({ playerId: RIYA }));

    expect(await dao.listByPlayer(BOB)).toEqual([second, first]);
  });

  it("lists the suspensions in effect at a moment: not ended, not lifted, and those until lifted", async () => {
    const dao = await createDao();
    const ended = await dao.insert(record({ startedAt: at(0), endsAt: at(24) }));
    const lasting = await dao.insert(record({ playerId: RIYA, startedAt: at(10), endsAt: at(34) }));
    const untilLifted = await dao.insert(
      record({ playerId: "user_bbbbbbbbbbbbbbbbbbbbbbbb", startedAt: at(1), endsAt: null }),
    );

    const active = await dao.listActive({ at: at(30) });

    expect(active).toEqual(expect.arrayContaining([lasting, untilLifted]));
    expect(active).not.toContainEqual(ended);
    expect(active).toHaveLength(2);
  });

  it("lifts a suspension once, with who and when, and it is no longer in effect", async () => {
    const dao = await createDao();
    const untilLifted = await dao.insert(record({ endsAt: null, duration: "until-lifted" }));
    const lift = {
      suspensionId: untilLifted.suspensionId,
      liftedAt: at(5),
      liftedById: OWNER,
      liftedByName: "Owner",
      deleteAt: at(5 + 180 * 24),
    };

    expect(await dao.lift(lift)).toBe(true);
    expect(await dao.lift({ ...lift, liftedAt: at(6) })).toBe(false);

    expect(await dao.getById(untilLifted.suspensionId)).toEqual({
      ...untilLifted,
      liftedAt: at(5),
      liftedById: OWNER,
      liftedByName: "Owner",
      deleteAt: at(5 + 180 * 24),
    });
    expect(await dao.listActive({ at: at(6) })).toEqual([]);
  });

  it("does not lift a suspension that has already ended", async () => {
    const dao = await createDao();
    const ended = await dao.insert(record({ startedAt: at(0), endsAt: at(24) }));

    const lifted = await dao.lift({
      suspensionId: ended.suspensionId,
      liftedAt: at(30),
      liftedById: OWNER,
      liftedByName: "Owner",
      deleteAt: at(30),
    });

    expect(lifted).toBe(false);
    expect(await dao.getById(ended.suspensionId)).toEqual(ended);
  });

  it("deletes every suspension of one player and nobody else's", async () => {
    const dao = await createDao();
    await dao.insert(record());
    await dao.insert(record({ endsAt: null }));
    const riya = await dao.insert(record({ playerId: RIYA }));

    expect(await dao.deleteByPlayer(BOB)).toBe(2);
    expect(await dao.deleteByPlayer(BOB)).toBe(0);

    expect(await dao.listByPlayer(BOB)).toEqual([]);
    expect(await dao.listByPlayer(RIYA)).toEqual([riya]);
  });
}
