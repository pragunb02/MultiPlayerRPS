import { expect, it } from "vitest";

const T0 = Date.UTC(2026, 9, 20, 12);
const at = (seconds) => new Date(T0 + seconds * 1000);
const KEEP = new Date(Date.UTC(2027, 0, 18));

/** One day's counts for one side of a flag, as the accessor writes them. */
export const countRow = ({
  flag = "new_lobby",
  day = "2026-10-20",
  side = "on",
  exposures = 1,
  successes = 0,
} = {}) => ({
  flag,
  day,
  side,
  exposures,
  successes,
  expiresAt: KEEP,
});

/**
 * Behaviour every feature flag DAO must have (CC-312): the MongoDB DAO and the in-memory double.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/featureFlagDao.js").createFeatureFlagDao>>} createDao
 */
export function runFeatureFlagDaoContract(createDao) {
  it("has no overrides at first", async () => {
    const dao = await createDao();

    expect(await dao.listOverrides()).toEqual([]);
  });

  it("stores an override, and a second one for the same flag replaces it", async () => {
    const dao = await createDao();

    expect(await dao.setOverride({ name: "new_lobby", rollout: 10, updatedAt: at(0) })).toEqual({
      name: "new_lobby",
      rollout: 10,
      updatedAt: at(0),
    });
    await dao.setOverride({ name: "new_lobby", rollout: "on", updatedAt: at(5) });
    await dao.setOverride({ name: "new_board", rollout: "off", updatedAt: at(6) });

    const overrides = await dao.listOverrides();
    expect([...overrides].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "new_board", rollout: "off", updatedAt: at(6) },
      { name: "new_lobby", rollout: "on", updatedAt: at(5) },
    ]);
  });

  it("clears an override and says whether there was one", async () => {
    const dao = await createDao();
    await dao.setOverride({ name: "new_lobby", rollout: 10, updatedAt: at(0) });

    expect(await dao.clearOverride("new_lobby")).toBe(1);
    expect(await dao.clearOverride("new_lobby")).toBe(0);
    expect(await dao.listOverrides()).toEqual([]);
  });

  it("adds counts to what a day already has, per flag and side", async () => {
    const dao = await createDao();

    await dao.addCounts([countRow({ exposures: 3, successes: 1 }), countRow({ side: "off", exposures: 2 })]);
    await dao.addCounts([countRow({ exposures: 4, successes: 2 })]);
    await dao.addCounts([]);

    const sums = await dao.countsSince("2026-10-01");
    expect([...sums].sort((a, b) => a.side.localeCompare(b.side))).toEqual([
      { flag: "new_lobby", side: "off", exposures: 2, successes: 0 },
      { flag: "new_lobby", side: "on", exposures: 7, successes: 3 },
    ]);
  });

  it("sums the days from the given one on, and leaves out days before it", async () => {
    const dao = await createDao();

    await dao.addCounts([
      countRow({ day: "2026-09-30", exposures: 100 }),
      countRow({ day: "2026-10-01", exposures: 5 }),
      countRow({ day: "2026-10-02", exposures: 6, successes: 1 }),
      countRow({ flag: "new_board", day: "2026-10-02", exposures: 9 }),
    ]);

    const sums = await dao.countsSince("2026-10-01");
    expect([...sums].sort((a, b) => a.flag.localeCompare(b.flag))).toEqual([
      { flag: "new_board", side: "on", exposures: 9, successes: 0 },
      { flag: "new_lobby", side: "on", exposures: 11, successes: 1 },
    ]);
  });
}
