import { describe, expect, it } from "vitest";

const AT = new Date(Date.UTC(2026, 9, 16, 12));
const LATER = new Date(Date.UTC(2026, 9, 17, 12));

const statsDoc = (overrides = {}) => ({
  playerId: "guest_a",
  winsByGame: {},
  matchesByGame: {},
  checkmateWins: 0,
  questsCompleted: 0,
  winStreak: { current: 0, best: 0 },
  dailyStreak: { current: 0, best: 0, lastDay: "" },
  recentKeys: [],
  mergedFrom: [],
  updatedAt: AT,
  ...overrides,
});

const questDay = (overrides = {}) => ({
  playerId: "guest_a",
  day: "2026-10-16",
  items: [
    {
      id: "win-1",
      name: "First blood",
      description: "Get a win",
      counts: "win",
      gameId: null,
      target: 1,
      bonusXp: 20,
      progress: 0,
      completedAt: null,
      seenGames: [],
      run: 0,
    },
  ],
  sweepAt: null,
  recentKeys: [],
  expiresAt: LATER,
  ...overrides,
});

/**
 * Behaviour every stats DAO must have (MongoDB DAO and the in-memory double).
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/statsDao.js").createStatsDao>>} createDao
 */
export function runStatsDaoContract(createDao) {
  describe("stats DAO contract", () => {
    it("throws for a player without stats", async () => {
      const dao = await createDao();

      await expect(dao.findByPlayer("guest_nobody")).rejects.toThrow(RangeError);
    });

    it("creates a player's stats at version 1 and reads them back, empty maps included", async () => {
      const dao = await createDao();

      expect(await dao.save({ doc: statsDoc(), expectedVersion: 0 })).toBe(true);

      expect(await dao.findByPlayer("guest_a")).toEqual({ ...statsDoc(), version: 1 });
    });

    it("refuses to create stats that already exist", async () => {
      const dao = await createDao();
      await dao.save({ doc: statsDoc(), expectedVersion: 0 });

      expect(await dao.save({ doc: statsDoc({ checkmateWins: 9 }), expectedVersion: 0 })).toBe(false);
      expect((await dao.findByPlayer("guest_a")).checkmateWins).toBe(0);
    });

    it("saves over the version it read, and refuses a stale version", async () => {
      const dao = await createDao();
      await dao.save({ doc: statsDoc(), expectedVersion: 0 });
      const next = statsDoc({
        winsByGame: { rps: 1 },
        winStreak: { current: 1, best: 1 },
        recentKeys: ["m1"],
      });

      expect(await dao.save({ doc: next, expectedVersion: 1 })).toBe(true);
      expect(await dao.save({ doc: statsDoc(), expectedVersion: 1 })).toBe(false);

      expect(await dao.findByPlayer("guest_a")).toEqual({ ...next, version: 2 });
    });

    it("deletes a player's stats, reporting how many went", async () => {
      const dao = await createDao();
      await dao.save({ doc: statsDoc(), expectedVersion: 0 });

      expect(await dao.deleteByPlayer("guest_a")).toBe(1);
      expect(await dao.deleteByPlayer("guest_a")).toBe(0);
      await expect(dao.findByPlayer("guest_a")).rejects.toThrow(RangeError);
    });
  });
}

/**
 * Behaviour every quest DAO must have.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/questDao.js").createQuestDao>>} createDao
 */
export function runQuestDaoContract(createDao) {
  describe("quest DAO contract", () => {
    it("throws for a day without quests", async () => {
      const dao = await createDao();

      await expect(dao.findDay({ playerId: "guest_a", day: "2026-10-16" })).rejects.toThrow(RangeError);
    });

    it("stores one snapshot per player and day", async () => {
      const dao = await createDao();

      expect(await dao.save({ doc: questDay(), expectedVersion: 0 })).toBe(true);
      expect(await dao.save({ doc: questDay(), expectedVersion: 0 })).toBe(false);
      expect(await dao.save({ doc: questDay({ day: "2026-10-17" }), expectedVersion: 0 })).toBe(true);
      expect(await dao.save({ doc: questDay({ playerId: "guest_b" }), expectedVersion: 0 })).toBe(true);

      expect(await dao.findDay({ playerId: "guest_a", day: "2026-10-16" })).toEqual({
        ...questDay(),
        version: 1,
      });
    });

    it("saves over the version it read, and refuses a stale version", async () => {
      const dao = await createDao();
      await dao.save({ doc: questDay(), expectedVersion: 0 });
      const [item] = questDay().items;
      const next = questDay({
        items: [{ ...item, progress: 1, completedAt: AT.getTime() }],
        sweepAt: AT.getTime(),
        recentKeys: ["m1"],
      });

      expect(await dao.save({ doc: next, expectedVersion: 1 })).toBe(true);
      expect(await dao.save({ doc: questDay(), expectedVersion: 1 })).toBe(false);

      expect(await dao.findDay({ playerId: "guest_a", day: "2026-10-16" })).toEqual({ ...next, version: 2 });
    });

    it("deletes every day of one player only", async () => {
      const dao = await createDao();
      await dao.save({ doc: questDay(), expectedVersion: 0 });
      await dao.save({ doc: questDay({ day: "2026-10-17" }), expectedVersion: 0 });
      await dao.save({ doc: questDay({ playerId: "guest_b" }), expectedVersion: 0 });

      expect(await dao.deleteByPlayer("guest_a")).toBe(2);

      expect((await dao.findDay({ playerId: "guest_b", day: "2026-10-16" })).playerId).toBe("guest_b");
    });
  });
}

/**
 * Behaviour every achievement DAO must have.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/achievementDao.js").createAchievementDao>>} createDao
 */
export function runAchievementDaoContract(createDao) {
  const unlock = (overrides = {}) => ({
    playerId: "guest_a",
    achievementId: "first-win",
    unlockedAt: LATER,
    matchId: "m1",
    ...overrides,
  });

  describe("achievement DAO contract", () => {
    it("has no unlocks for a new player", async () => {
      const dao = await createDao();

      expect(await dao.listByPlayer("guest_a")).toEqual([]);
    });

    it("unlocks an achievement once, oldest first in the list", async () => {
      const dao = await createDao();

      expect(await dao.upsertEarliest(unlock())).toEqual({ created: true });
      expect(await dao.upsertEarliest(unlock({ achievementId: "first-match", unlockedAt: AT }))).toEqual({
        created: true,
      });
      expect(await dao.upsertEarliest(unlock({ matchId: "m2" }))).toEqual({ created: false });

      expect(await dao.listByPlayer("guest_a")).toEqual([
        unlock({ achievementId: "first-match", unlockedAt: AT }),
        unlock(),
      ]);
    });

    it("keeps the earliest time when the same achievement is recorded again", async () => {
      const dao = await createDao();
      await dao.upsertEarliest(unlock());

      await dao.upsertEarliest(unlock({ unlockedAt: AT, matchId: "m0" }));
      await dao.upsertEarliest(unlock({ unlockedAt: new Date(LATER.getTime() + 1) }));

      expect(await dao.listByPlayer("guest_a")).toEqual([unlock({ unlockedAt: AT })]);
    });

    it("deletes one player's unlocks only", async () => {
      const dao = await createDao();
      await dao.upsertEarliest(unlock());
      await dao.upsertEarliest(unlock({ achievementId: "first-match" }));
      await dao.upsertEarliest(unlock({ playerId: "guest_b" }));

      expect(await dao.deleteByPlayer("guest_a")).toBe(2);

      expect(await dao.listByPlayer("guest_a")).toEqual([]);
      expect(await dao.listByPlayer("guest_b")).toHaveLength(1);
    });
  });
}
