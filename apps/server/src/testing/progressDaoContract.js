import { expect, it } from "vitest";
import { DuplicateKey } from "../persistence/errors.js";

const AT = new Date(Date.UTC(2026, 9, 16, 12));
const WIN = { xp: 30, unrankedXp: 0, matchesPlayed: 1, wins: 1 };

/**
 * Behaviour every progress DAO must have (MongoDB DAO and the in-memory double).
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/progressDao.js").createProgressDao>>} createDao
 */
export function runProgressDaoContract(createDao) {
  it("starts a new player from zero and returns the totals before the change", async () => {
    const dao = await createDao();

    const result = await dao.applyMatchOnce({ playerId: "guest_a", matchId: "m1", inc: WIN, at: AT });

    expect(result).toEqual({
      applied: true,
      before: { xp: 0, unrankedXp: 0, matchesPlayed: 0, wins: 0, losses: 0, draws: 0 },
    });
    expect(await dao.getByPlayer("guest_a")).toEqual({
      playerId: "guest_a",
      xp: 30,
      unrankedXp: 0,
      matchesPlayed: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      updatedAt: AT,
    });
  });

  it("accumulates across matches", async () => {
    const dao = await createDao();
    await dao.applyMatchOnce({ playerId: "guest_a", matchId: "m1", inc: WIN, at: AT });

    const second = await dao.applyMatchOnce({
      playerId: "guest_a",
      matchId: "m2",
      inc: { xp: 10, unrankedXp: 0, matchesPlayed: 1, losses: 1 },
      at: AT,
    });

    expect(second.before.xp).toBe(30);
    expect((await dao.getByPlayer("guest_a")).xp).toBe(40);
  });

  it("applies each match only once per player", async () => {
    const dao = await createDao();
    await dao.applyMatchOnce({ playerId: "guest_a", matchId: "m1", inc: WIN, at: AT });

    const again = await dao.applyMatchOnce({ playerId: "guest_a", matchId: "m1", inc: WIN, at: AT });

    expect(again.applied).toBe(false);
    expect((await dao.getByPlayer("guest_a")).xp).toBe(30);
  });

  it("applies the same match independently to each player", async () => {
    const dao = await createDao();
    await dao.applyMatchOnce({ playerId: "guest_a", matchId: "m1", inc: WIN, at: AT });

    const other = await dao.applyMatchOnce({
      playerId: "guest_b",
      matchId: "m1",
      inc: { xp: 10, unrankedXp: 0, matchesPlayed: 1 },
      at: AT,
    });

    expect(other.applied).toBe(true);
  });

  it("throws for a player without progress", async () => {
    const dao = await createDao();

    await expect(dao.getByPlayer("guest_nobody")).rejects.toThrow(RangeError);
  });

  /** A guest with two matches: 40 XP. */
  async function guestWithTwoMatches(dao) {
    await dao.applyMatchOnce({ playerId: "guest_a", matchId: "m1", inc: WIN, at: AT });
    await dao.applyMatchOnce({
      playerId: "guest_a",
      matchId: "m2",
      inc: { xp: 10, unrankedXp: 0, matchesPlayed: 1, losses: 1 },
      at: AT,
    });
  }
  const GUEST_TOTALS = { xp: 40, unrankedXp: 0, matchesPlayed: 2, wins: 1, losses: 1, draws: 0 };
  const LATER = new Date(AT.getTime() + 60_000);

  it("marks a guest's progress as moved and returns what it holds; marking again returns the same", async () => {
    const dao = await createDao();
    await guestWithTwoMatches(dao);

    const first = await dao.markMergedInto({ from: "guest_a", to: "user_1", at: LATER });
    const again = await dao.markMergedInto({ from: "guest_a", to: "user_1", at: LATER });

    expect(first).toEqual({ totals: GUEST_TOTALS, recentMatchIds: ["m1", "m2"] });
    expect(again).toEqual(first);
  });

  it("refuses to mark a guest's progress for a second account", async () => {
    const dao = await createDao();
    await guestWithTwoMatches(dao);
    await dao.markMergedInto({ from: "guest_a", to: "user_1", at: LATER });

    await expect(dao.markMergedInto({ from: "guest_a", to: "user_2", at: LATER })).rejects.toThrow(
      DuplicateKey,
    );
  });

  it("leaves a marker even for a guest without progress, so later matches still find the account", async () => {
    const dao = await createDao();

    const marked = await dao.markMergedInto({ from: "guest_new", to: "user_1", at: LATER });
    const late = await dao.applyMatchOnce({ playerId: "guest_new", matchId: "m9", inc: WIN, at: LATER });

    expect(marked).toEqual({
      totals: { xp: 0, unrankedXp: 0, matchesPlayed: 0, wins: 0, losses: 0, draws: 0 },
      recentMatchIds: [],
    });
    expect(late).toEqual({ applied: false, before: marked.totals, mergedInto: "user_1" });
  });

  it("applies nothing more to a moved guest, and names the account instead", async () => {
    const dao = await createDao();
    await guestWithTwoMatches(dao);
    await dao.markMergedInto({ from: "guest_a", to: "user_1", at: LATER });

    const late = await dao.applyMatchOnce({ playerId: "guest_a", matchId: "m3", inc: WIN, at: LATER });

    expect(late).toEqual({ applied: false, before: GUEST_TOTALS, mergedInto: "user_1" });
    expect((await dao.getByPlayer("guest_a")).xp).toBe(40);
  });

  it("adds a guest's totals to an account exactly once, and the guest's matches never count twice", async () => {
    const dao = await createDao();
    await dao.applyMatchOnce({ playerId: "user_1", matchId: "m-own", inc: WIN, at: AT });
    await guestWithTwoMatches(dao);
    const { totals, recentMatchIds } = await dao.markMergedInto({ from: "guest_a", to: "user_1", at: LATER });

    const first = await dao.addMerged({ to: "user_1", from: "guest_a", totals, recentMatchIds, at: LATER });
    const again = await dao.addMerged({ to: "user_1", from: "guest_a", totals, recentMatchIds, at: LATER });
    const replayed = await dao.applyMatchOnce({ playerId: "user_1", matchId: "m2", inc: WIN, at: LATER });

    expect([first, again]).toEqual([{ applied: true }, { applied: false }]);
    expect(replayed.applied).toBe(false);
    expect(await dao.getByPlayer("user_1")).toEqual({
      playerId: "user_1",
      xp: 70,
      unrankedXp: 0,
      matchesPlayed: 3,
      wins: 2,
      losses: 1,
      draws: 0,
      updatedAt: LATER,
    });
  });

  it("creates the account's progress when it has none yet", async () => {
    const dao = await createDao();
    await guestWithTwoMatches(dao);
    const { totals, recentMatchIds } = await dao.markMergedInto({
      from: "guest_a",
      to: "user_new",
      at: LATER,
    });

    await dao.addMerged({ to: "user_new", from: "guest_a", totals, recentMatchIds, at: LATER });

    expect(await dao.getByPlayer("user_new")).toEqual({
      playerId: "user_new",
      ...GUEST_TOTALS,
      updatedAt: LATER,
    });
  });

  it("resumes after a crash between the steps: marking and adding again moves the totals once", async () => {
    const dao = await createDao();
    await guestWithTwoMatches(dao);
    await dao.markMergedInto({ from: "guest_a", to: "user_1", at: LATER }); // …and the process died here

    for (let run = 0; run < 2; run++) {
      const { totals, recentMatchIds } = await dao.markMergedInto({
        from: "guest_a",
        to: "user_1",
        at: LATER,
      });
      await dao.addMerged({ to: "user_1", from: "guest_a", totals, recentMatchIds, at: LATER });
    }

    expect((await dao.getByPlayer("user_1")).xp).toBe(40);
  });

  it("merges several guests into one account", async () => {
    const dao = await createDao();
    await guestWithTwoMatches(dao);
    await dao.applyMatchOnce({ playerId: "guest_b", matchId: "m5", inc: WIN, at: AT });

    for (const from of ["guest_a", "guest_b"]) {
      const { totals, recentMatchIds } = await dao.markMergedInto({ from, to: "user_1", at: LATER });
      await dao.addMerged({ to: "user_1", from, totals, recentMatchIds, at: LATER });
    }

    expect((await dao.getByPlayer("user_1")).xp).toBe(70);
  });

  it("deletes a player's progress and the guest markers that point at them, nobody else's (CC-035)", async () => {
    const dao = await createDao();
    await dao.applyMatchOnce({ playerId: "user_a", matchId: "m1", inc: WIN, at: AT });
    await dao.applyMatchOnce({ playerId: "guest_g", matchId: "m2", inc: WIN, at: AT });
    await dao.markMergedInto({ from: "guest_g", to: "user_a", at: AT });
    await dao.applyMatchOnce({ playerId: "user_b", matchId: "m3", inc: WIN, at: AT });

    expect(await dao.deleteByPlayer("user_a")).toBe(2);
    expect(await dao.deleteByPlayer("user_a")).toBe(0);

    await expect(dao.getByPlayer("user_a")).rejects.toThrow(RangeError);
    await expect(dao.getByPlayer("guest_g")).rejects.toThrow(RangeError);
    expect((await dao.getByPlayer("user_b")).xp).toBe(30);
  });
}
