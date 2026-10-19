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

  it("lists every entry of one player, on every board and period (CC-035)", async () => {
    const dao = await createDao();
    await dao.raiseScore({ ...XP, ...player("user_a", "alice", 2), score: 80, at: at() });
    await dao.addOnce({ ...WEEK, ...player("user_a", "alice", 2), key: "m1", inc: 30, at: at(1) });
    await dao.raiseScore({ ...XP, ...player("user_b", "bob"), score: 10, at: at() });

    const entries = await dao.listByPlayer("user_a");

    expect(entries.map(({ board, period, score }) => ({ board, period, score }))).toEqual(
      expect.arrayContaining([
        { board: "xp", period: "all", score: 80 },
        { board: "xp", period: "2026-W42", score: 30 },
      ]),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ displayName: "alice", level: 2 });
    expect(entries[0]).not.toHaveProperty("recentKeys");
    expect(await dao.listByPlayer("user_nobody")).toEqual([]);
  });

  it("deletes every entry of one player and nobody else's (CC-035)", async () => {
    const dao = await createDao();
    await dao.raiseScore({ ...XP, ...player("user_a", "alice", 2), score: 80, at: at() });
    await dao.addOnce({ ...WEEK, ...player("user_a", "alice", 2), key: "m1", inc: 30, at: at(1) });
    await dao.raiseScore({ ...XP, ...player("user_b", "bob"), score: 10, at: at() });

    expect(await dao.deleteByPlayer("user_a")).toBe(2);
    expect(await dao.deleteByPlayer("user_a")).toBe(0);

    expect(await dao.top({ ...XP, limit: 10 })).toEqual([
      expect.objectContaining({ playerId: "user_b", score: 10 }),
    ]);
  });

  it("lists one player's rows of one board with their keys and end, for a guest transfer (CC-291)", async () => {
    const dao = await createDao();
    await dao.addOnce({ ...WEEK, ...player("guest_a"), key: "m1", inc: 30, at: at(), expiresAt: at(9) });
    await dao.addOnce({
      ...WEEK,
      ...player("guest_a"),
      key: "quest:q",
      inc: 20,
      at: at(1),
      expiresAt: at(10),
    });
    await dao.raiseScore({ ...XP, ...player("guest_a"), score: 50, at: at(1) });
    await dao.raiseScore({ board: "wins:rps", period: "all", ...player("guest_a"), score: 1, at: at(1) });
    await dao.addOnce({ ...WEEK, ...player("user_b"), key: "m2", inc: 10, at: at() });

    const rows = await dao.listWithKeys({ board: "xp", playerId: "guest_a" });

    expect(rows.sort((a, b) => a.period.localeCompare(b.period))).toEqual([
      { period: "2026-W42", score: 50, updatedAt: at(1), recentKeys: ["m1", "quest:q"], expiresAt: at(10) },
      { period: "all", score: 50, updatedAt: at(1), recentKeys: [] },
    ]);
    expect(await dao.listWithKeys({ board: "xp", playerId: "user_nobody" })).toEqual([]);
  });

  it("adds a merged score once per key and remembers the keys it came with (CC-291)", async () => {
    const dao = await createDao();
    await dao.addOnce({ ...WEEK, ...player("user_a"), key: "m-own", inc: 30, at: at() });
    const merge = {
      ...WEEK,
      ...player("user_a", "alice", 2),
      key: "guest:g",
      keys: ["m1", "quest:q"],
      inc: 50,
    };

    const first = await dao.mergeOnce({ ...merge, at: at(5), expiresAt: at(100) });
    const again = await dao.mergeOnce({ ...merge, at: at(6), expiresAt: at(100) });
    const replayed = await dao.addOnce({ ...WEEK, ...player("user_a"), key: "m1", inc: 30, at: at(7) });

    expect([first, again, replayed]).toEqual([{ applied: true }, { applied: false }, { applied: false }]);
    expect(await dao.listWithKeys({ board: "xp", playerId: "user_a" })).toEqual([
      {
        period: "2026-W42",
        score: 80,
        updatedAt: at(5),
        recentKeys: ["m-own", "m1", "quest:q", "guest:g"],
        expiresAt: at(100),
      },
    ]);
    expect(await dao.getEntry({ ...WEEK, playerId: "user_a" })).toMatchObject({
      displayName: "alice",
      level: 2,
    });
  });

  it("creates the row when a merge comes first (CC-291)", async () => {
    const dao = await createDao();

    const result = await dao.mergeOnce({
      ...WEEK,
      ...player("user_a"),
      key: "guest:g",
      keys: [],
      inc: 20,
      at: at(),
      expiresAt: at(100),
    });

    expect(result).toEqual({ applied: true });
    expect((await dao.getEntry({ ...WEEK, playerId: "user_a" })).score).toBe(20);
  });

  it("moves the end of one player's rows of a period later, never earlier, and nobody else's (CC-291)", async () => {
    const dao = await createDao();
    await dao.raiseScore({ ...XP, ...player("guest_a"), score: 50, at: at(), expiresAt: at(10) });
    const wins = { board: "wins:rps", period: "all" };
    await dao.raiseScore({ ...wins, ...player("guest_a"), score: 1, at: at(), expiresAt: at(30) });
    await dao.addOnce({ ...WEEK, ...player("guest_a"), key: "m1", inc: 30, at: at(), expiresAt: at(10) });
    await dao.raiseScore({ ...XP, ...player("guest_b"), score: 50, at: at(), expiresAt: at(10) });

    const moved = await dao.extendLifetime({ playerId: "guest_a", period: "all", expiresAt: at(20) });

    expect(moved).toBe(1);
    const endOf = async (board, playerId) =>
      (await dao.listWithKeys({ board, playerId }))
        .map(({ period, expiresAt }) => [period, expiresAt])
        .sort();
    expect(await endOf("xp", "guest_a")).toEqual([
      ["2026-W42", at(10)],
      ["all", at(20)],
    ]);
    expect(await endOf("wins:rps", "guest_a")).toEqual([["all", at(30)]]);
    expect(await endOf("xp", "guest_b")).toEqual([["all", at(10)]]);
  });
}
