import { describe, expect, it } from "vitest";
import {
  createInMemoryAchievementDao,
  createInMemoryQuestDao,
  createInMemoryStatsDao,
} from "../testing/inMemoryGamificationDaos.js";
import { ConflictError } from "../utils/errors.js";
import { createGamificationAccessor } from "./gamificationAccessor.js";

const AT = Date.UTC(2026, 9, 16, 12);
const EMPTY = Object.freeze({
  playerId: "guest_a",
  winsByGame: {},
  matchesByGame: {},
  checkmateWins: 0,
  questsCompleted: 0,
  winStreak: { current: 0, best: 0 },
  dailyStreak: { current: 0, best: 0, lastDay: "" },
  mergedFrom: [],
});
const addWin = (stats) => ({ ...stats, winsByGame: { rps: (stats.winsByGame.rps ?? 0) + 1 } });
const questDay = (progress = 0) => ({
  playerId: "guest_a",
  day: "2026-10-16",
  items: [{ id: "win-1", progress }],
  sweepAt: null,
});

function setup(overrides = {}) {
  const daos = {
    statsDao: createInMemoryStatsDao(),
    questDao: createInMemoryQuestDao(),
    achievementDao: createInMemoryAchievementDao(),
    ...overrides,
  };
  return { ...daos, accessor: createGamificationAccessor(daos) };
}

describe("gamificationAccessor: stats", () => {
  it("gives a player without stats the domain's empty stats", async () => {
    const { accessor } = setup();

    expect(await accessor.getStats({ playerId: "guest_a", empty: EMPTY })).toEqual(EMPTY);
  });

  it("applies a change once per key, and returns frozen stats", async () => {
    const { accessor } = setup();
    const apply = () =>
      accessor.applyToStatsOnce({ playerId: "guest_a", key: "m1", at: AT, empty: EMPTY, change: addWin });

    const first = await apply();
    const again = await apply();

    expect(first.applied).toBe(true);
    expect(again).toEqual({ applied: false, stats: expect.objectContaining({ winsByGame: { rps: 1 } }) });
    expect(Object.isFrozen(first.stats.winsByGame)).toBe(true);
    expect(await accessor.getStats({ playerId: "guest_a", empty: EMPTY })).toEqual({
      ...EMPTY,
      winsByGame: { rps: 1 },
    });
  });

  it("remembers the last 200 keys", async () => {
    const { accessor } = setup();
    const apply = (key) =>
      accessor.applyToStatsOnce({ playerId: "guest_a", key, at: AT, empty: EMPTY, change: addWin });
    for (let i = 0; i <= 200; i++) {
      await apply(`m${i}`);
    }

    expect((await apply("m200")).applied).toBe(false);
    expect((await apply("m0")).applied).toBe(true);
  });

  it("retries when another write got in first, and gives up with a conflict when it keeps happening", async () => {
    const real = createInMemoryStatsDao();
    let refusals = 1;
    const flaky = { ...real, save: async (write) => (refusals-- > 0 ? false : real.save(write)) };
    const { accessor } = setup({ statsDao: flaky });

    const { applied } = await accessor.applyToStatsOnce({
      playerId: "guest_a",
      key: "m1",
      at: AT,
      empty: EMPTY,
      change: addWin,
    });
    expect(applied).toBe(true);

    const { accessor: stuck } = setup({ statsDao: { ...real, save: async () => false } });
    await expect(
      stuck.applyToStatsOnce({ playerId: "guest_a", key: "m2", at: AT, empty: EMPTY, change: addWin }),
    ).rejects.toThrow(ConflictError);
  });

  it("passes storage failures through", async () => {
    const broken = {
      ...createInMemoryStatsDao(),
      findByPlayer: async () => {
        throw new Error("db down");
      },
    };
    const { accessor } = setup({ statsDao: broken });

    await expect(accessor.getStats({ playerId: "guest_a", empty: EMPTY })).rejects.toThrow("db down");
  });

  it("rewrites stats and remembers the keys it was rebuilt from", async () => {
    const { accessor } = setup();

    const stats = await accessor.rewriteStats({
      playerId: "guest_a",
      at: AT,
      empty: EMPTY,
      seenKeys: ["m1", "m2"],
      change: (s) => ({ ...s, checkmateWins: 2 }),
    });
    const replay = await accessor.applyToStatsOnce({
      playerId: "guest_a",
      key: "m2",
      at: AT,
      empty: EMPTY,
      change: addWin,
    });

    expect(stats.checkmateWins).toBe(2);
    expect(replay.applied).toBe(false);
  });

  it("removes a player's stats", async () => {
    const { accessor } = setup();
    await accessor.applyToStatsOnce({ playerId: "guest_a", key: "m1", at: AT, empty: EMPTY, change: addWin });

    expect(await accessor.removeStats("guest_a")).toBe(1);
    expect(await accessor.getStats({ playerId: "guest_a", empty: EMPTY })).toEqual(EMPTY);
  });
});

describe("gamificationAccessor: quests", () => {
  const key = { playerId: "guest_a", day: "2026-10-16" };

  it("creates the day's snapshot on first read and keeps it", async () => {
    const { accessor } = setup();
    let created = 0;
    const create = () => {
      created++;
      return questDay(created);
    };

    const first = await accessor.getQuestDay({ ...key, create });
    const second = await accessor.getQuestDay({ ...key, create });

    expect(first).toEqual(questDay(1));
    expect(second).toEqual(questDay(1));
    expect(created).toBe(1);
  });

  it("expires a day's snapshot eight days after the day starts", async () => {
    const { accessor, questDao } = setup();

    await accessor.getQuestDay({ ...key, create: () => questDay() });

    expect((await questDao.findDay(key)).expiresAt).toEqual(new Date(Date.UTC(2026, 9, 24)));
  });

  it("uses the snapshot someone else just created instead of its own", async () => {
    const real = createInMemoryQuestDao();
    const racing = {
      ...real,
      save: async (write) => {
        await real.save({
          doc: { ...write.doc, items: [{ id: "theirs", progress: 0 }] },
          expectedVersion: 0,
        });
        return real.save(write);
      },
    };
    const { accessor } = setup({ questDao: racing });

    const day = await accessor.getQuestDay({ ...key, create: () => questDay() });

    expect(day.items[0].id).toBe("theirs");
  });

  it("applies a match to the day once, creating the day if needed", async () => {
    const { accessor } = setup();
    const apply = () =>
      accessor.applyToQuestDayOnce({
        ...key,
        key: "m1",
        create: () => questDay(),
        change: (day) => ({ ...day, items: [{ ...day.items[0], progress: day.items[0].progress + 1 }] }),
      });

    expect((await apply()).applied).toBe(true);
    expect(await apply()).toEqual({ applied: false, questDay: questDay(1) });
  });

  it("removes every day of a player", async () => {
    const { accessor } = setup();
    await accessor.getQuestDay({ ...key, create: () => questDay() });

    expect(await accessor.removeQuestDays("guest_a")).toBe(1);
  });
});

describe("gamificationAccessor: achievements", () => {
  it("unlocks once and lists unlocks with times in ms", async () => {
    const { accessor } = setup();
    const unlock = { playerId: "guest_a", achievementId: "first-win", unlockedAt: AT, matchId: "m1" };

    expect(await accessor.unlock(unlock)).toBe(true);
    expect(await accessor.unlock(unlock)).toBe(false);
    expect(await accessor.listUnlocks("guest_a")).toEqual([
      { achievementId: "first-win", unlockedAt: AT, matchId: "m1" },
    ]);
  });

  it("moves unlocks to another player, keeping the earlier time, and can repeat", async () => {
    const { accessor } = setup();
    await accessor.unlock({ playerId: "guest_a", achievementId: "first-win", unlockedAt: AT, matchId: "m1" });
    await accessor.unlock({
      playerId: "guest_a",
      achievementId: "first-match",
      unlockedAt: AT,
      matchId: "m1",
    });
    await accessor.unlock({
      playerId: "user_b",
      achievementId: "first-win",
      unlockedAt: AT + 5,
      matchId: "m9",
    });

    expect(await accessor.moveUnlocks({ from: "guest_a", to: "user_b" })).toBe(2);
    expect(await accessor.moveUnlocks({ from: "guest_a", to: "user_b" })).toBe(0);

    expect(await accessor.listUnlocks("guest_a")).toEqual([]);
    expect((await accessor.listUnlocks("user_b")).map((u) => [u.achievementId, u.unlockedAt])).toEqual([
      ["first-match", AT],
      ["first-win", AT],
    ]);
  });

  it("checks its dependencies at construction", () => {
    expect(() => createGamificationAccessor({})).toThrow(TypeError);
    expect(() => createGamificationAccessor({ statsDao: {} })).toThrow(TypeError);
    expect(() => createGamificationAccessor({ statsDao: {}, questDao: {} })).toThrow(TypeError);
  });

  it("lists every quest day of a player and removes every unlock of a player (CC-035)", async () => {
    const achievementDao = createInMemoryAchievementDao();
    const questDao = createInMemoryQuestDao();
    const gamification = createGamificationAccessor({
      statsDao: createInMemoryStatsDao(),
      questDao,
      achievementDao,
    });
    await gamification.getQuestDay({ playerId: "guest_a", day: "2026-10-16", create: () => questDay() });
    await gamification.unlock({
      playerId: "guest_a",
      achievementId: "first-win",
      unlockedAt: AT,
      matchId: "m1",
    });

    const days = await gamification.listQuestDays("guest_a");
    expect(days).toEqual([expect.objectContaining({ playerId: "guest_a", day: "2026-10-16" })]);
    expect(Object.isFrozen(days[0])).toBe(true);
    expect(await gamification.removeUnlocks("guest_a")).toBe(1);
    expect(await gamification.listUnlocks("guest_a")).toEqual([]);
  });
});
