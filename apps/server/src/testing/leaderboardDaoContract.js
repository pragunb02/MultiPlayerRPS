import { expect, it } from "vitest";

const T0 = Date.UTC(2026, 9, 16, 12);
const at = (offset = 0) => new Date(T0 + offset);
const XP = Object.freeze({ board: "xp", period: "all" });
const WEEK = Object.freeze({ board: "xp", period: "2026-W42" });
const player = (playerId, displayName = playerId, level = 1) => ({ playerId, displayName, level });

/**
 * Behaviour every leaderboard DAO must have (MongoDB DAO and the in-memory double).
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/leaderboardDao.js").createLeaderboardDao>>} createDao
 */
export function runLeaderboardDaoContract(createDao) {
  it("creates an entry with a raised score and reads it back", async () => {
    const dao = await createDao();

    const result = await dao.raiseScore({ ...XP, ...player("user_a", "alice", 2), score: 80, at: at() });

    expect(result).toEqual({ raised: true });
    expect(await dao.getEntry({ ...XP, playerId: "user_a" })).toEqual({
      playerId: "user_a",
      displayName: "alice",
      level: 2,
      score: 80,
      updatedAt: at(),
    });
  });

  it("raises a score only upwards, keeping when it was reached, but refreshes name and level", async () => {
    const dao = await createDao();
    await dao.raiseScore({ ...XP, ...player("user_a", "alice", 2), score: 80, at: at() });

    const same = await dao.raiseScore({ ...XP, ...player("user_a", "alice2", 3), score: 80, at: at(5) });
    const lower = await dao.raiseScore({ ...XP, ...player("user_a", "alice2", 3), score: 40, at: at(6) });

    expect([same, lower]).toEqual([{ raised: false }, { raised: false }]);
    expect(await dao.getEntry({ ...XP, playerId: "user_a" })).toEqual({
      playerId: "user_a",
      displayName: "alice2",
      level: 3,
      score: 80,
      updatedAt: at(),
    });

    expect(await dao.raiseScore({ ...XP, ...player("user_a"), score: 90, at: at(7) })).toEqual({
      raised: true,
    });
    expect((await dao.getEntry({ ...XP, playerId: "user_a" })).updatedAt).toEqual(at(7));
  });

  it("adds to a score once per key", async () => {
    const dao = await createDao();

    const first = await dao.addOnce({ ...WEEK, ...player("user_a"), key: "m1", inc: 30, at: at() });
    const again = await dao.addOnce({ ...WEEK, ...player("user_a"), key: "m1", inc: 30, at: at(1) });
    const second = await dao.addOnce({ ...WEEK, ...player("user_a"), key: "m2", inc: 10, at: at(2) });

    expect([first, again, second]).toEqual([{ applied: true }, { applied: false }, { applied: true }]);
    expect(await dao.getEntry({ ...WEEK, playerId: "user_a" })).toEqual(
      expect.objectContaining({ score: 40, updatedAt: at(2) }),
    );
  });

  it("keeps boards and periods apart", async () => {
    const dao = await createDao();
    await dao.addOnce({ ...WEEK, ...player("user_a"), key: "m1", inc: 30, at: at(), expiresAt: at(1e9) });

    expect(await dao.top({ ...XP, limit: 10 })).toEqual([]);
    expect(await dao.top({ board: "wins:chess", period: "2026-W42", limit: 10 })).toEqual([]);
    await expect(dao.getEntry({ ...XP, playerId: "user_a" })).rejects.toThrow(RangeError);
  });

  it("lists the best first, earlier on a tie, up to the limit", async () => {
    const dao = await createDao();
    await dao.raiseScore({ ...XP, ...player("user_late"), score: 50, at: at(10) });
    await dao.raiseScore({ ...XP, ...player("user_low"), score: 10, at: at(0) });
    await dao.raiseScore({ ...XP, ...player("user_early"), score: 50, at: at(5) });
    await dao.raiseScore({ ...XP, ...player("user_top"), score: 90, at: at(20) });

    const top = await dao.top({ ...XP, limit: 3 });

    expect(top.map((entry) => entry.playerId)).toEqual(["user_top", "user_early", "user_late"]);
  });

  it("counts the entries ranked above one, with the same tie rules as the list", async () => {
    const dao = await createDao();
    await dao.raiseScore({ ...XP, ...player("user_b"), score: 50, at: at(5) });
    await dao.raiseScore({ ...XP, ...player("user_a"), score: 50, at: at(5) });
    await dao.raiseScore({ ...XP, ...player("user_c"), score: 50, at: at(10) });
    await dao.raiseScore({ ...XP, ...player("user_top"), score: 90, at: at(20) });

    const counts = [];
    for (const playerId of ["user_top", "user_a", "user_b", "user_c"]) {
      counts.push(await dao.countAhead({ ...XP, ...(await dao.getEntry({ ...XP, playerId })) }));
    }

    expect(counts).toEqual([0, 1, 2, 3]);
    expect((await dao.top({ ...XP, limit: 10 })).map((entry) => entry.playerId)).toEqual([
      "user_top",
      "user_a",
      "user_b",
      "user_c",
    ]);
  });
}
