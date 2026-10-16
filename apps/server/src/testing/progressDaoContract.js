import { expect, it } from "vitest";

const AT = new Date(Date.UTC(2026, 9, 16, 12));
const WIN = { xp: 30, matchesPlayed: 1, wins: 1 };

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
      before: { xp: 0, matchesPlayed: 0, wins: 0, losses: 0, draws: 0 },
    });
    expect(await dao.getByPlayer("guest_a")).toEqual({
      playerId: "guest_a",
      xp: 30,
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
      inc: { xp: 10, matchesPlayed: 1, losses: 1 },
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
      inc: { xp: 10, matchesPlayed: 1 },
      at: AT,
    });

    expect(other.applied).toBe(true);
  });

  it("throws for a player without progress", async () => {
    const dao = await createDao();

    await expect(dao.getByPlayer("guest_nobody")).rejects.toThrow(RangeError);
  });
}
