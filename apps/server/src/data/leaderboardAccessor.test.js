import { describe, expect, it } from "vitest";
import { createInMemoryLeaderboardDao } from "../testing/inMemoryLeaderboardDao.js";
import { NotFoundError } from "../utils/errors.js";
import { createLeaderboardAccessor } from "./leaderboardAccessor.js";

const T0 = Date.UTC(2026, 9, 16, 12);
const XP = Object.freeze({ board: "xp", period: "all" });
const write = (playerId, score, at = T0) => ({ ...XP, playerId, displayName: playerId, level: 2, score, at });
const setup = () => createLeaderboardAccessor({ leaderboardDao: createInMemoryLeaderboardDao() });

describe("leaderboardAccessor", () => {
  it("lists entries best first as frozen domain models with ms timestamps", async () => {
    const boards = setup();
    await boards.raiseScore(write("user_a", 40));
    await boards.raiseScore(write("user_b", 90, T0 + 5));

    const top = await boards.listTop({ ...XP, limit: 10 });

    expect(top).toEqual([
      { playerId: "user_b", displayName: "user_b", level: 2, score: 90, updatedAt: T0 + 5 },
      { playerId: "user_a", displayName: "user_a", level: 2, score: 40, updatedAt: T0 },
    ]);
    expect(Object.isFrozen(top)).toBe(true);
    expect(Object.isFrozen(top[0])).toBe(true);
  });

  it("adds once per key, with an optional expiry", async () => {
    const boards = setup();
    const week = { ...write("user_a", 0), period: "2026-W42", key: "m1", inc: 30, expiresAt: T0 + 1e9 };

    expect(await boards.addOnce(week)).toEqual({ applied: true });
    expect(await boards.addOnce(week)).toEqual({ applied: false });
    expect(await boards.getStanding({ board: "xp", period: "2026-W42", playerId: "user_a" })).toEqual({
      rank: 1,
      score: 30,
    });
  });

  it("merges a guest's weekly row into an account's once, remembering the guest's keys (CC-291)", async () => {
    const boards = setup();
    const week = { ...write("user_a", 0), period: "2026-W42", expiresAt: T0 + 1e9 };

    await boards.mergeOnce({ ...week, key: "guest:g", keys: ["m1"], inc: 40 });
    await boards.mergeOnce({ ...week, key: "guest:g", keys: ["m1"], inc: 40 });
    await boards.addOnce({ ...week, key: "m1", inc: 30 });

    const rows = await boards.listWithKeys({ board: "xp", playerId: "user_a" });
    expect(rows).toEqual([
      { period: "2026-W42", score: 40, updatedAt: T0, recentKeys: ["m1", "guest:g"], expiresAt: T0 + 1e9 },
    ]);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
    expect(Object.isFrozen(rows[0].recentKeys)).toBe(true);
  });

  it("lists rows without an end as such, and moves a player's ends later (CC-291)", async () => {
    const boards = setup();
    await boards.raiseScore({ ...write("guest_a", 30), expiresAt: T0 + 10 });
    await boards.raiseScore(write("user_a", 30));

    expect(await boards.extendLifetime({ playerId: "guest_a", period: "all", expiresAt: T0 + 20 })).toBe(1);

    expect(await boards.listWithKeys({ board: "xp", playerId: "guest_a" })).toEqual([
      { period: "all", score: 30, updatedAt: T0, recentKeys: [], expiresAt: T0 + 20 },
    ]);
    expect(await boards.listWithKeys({ board: "xp", playerId: "user_a" })).toEqual([
      { period: "all", score: 30, updatedAt: T0, recentKeys: [] },
    ]);
  });

  it("reports a player's rank, counting everyone ahead", async () => {
    const boards = setup();
    await boards.raiseScore(write("user_a", 40));
    await boards.raiseScore(write("user_b", 90));
    await boards.raiseScore(write("user_c", 40, T0 + 1));

    expect(await boards.getStanding({ ...XP, playerId: "user_c" })).toEqual({ rank: 3, score: 40 });
  });

  it("reports a player who is not on the board as not found", async () => {
    await expect(setup().getStanding({ ...XP, playerId: "user_nobody" })).rejects.toThrow(NotFoundError);
  });

  it("passes unexpected storage failures through unchanged", async () => {
    const failure = new Error("disk on fire");
    const boards = createLeaderboardAccessor({
      leaderboardDao: {
        getEntry: async () => {
          throw failure;
        },
      },
    });

    await expect(boards.getStanding({ ...XP, playerId: "user_a" })).rejects.toBe(failure);
  });

  it("fails fast without a DAO", () => {
    expect(() => createLeaderboardAccessor({})).toThrow(TypeError);
  });

  it("lists every entry of a player with ms times, and removes them (CC-035)", async () => {
    const boards = setup();
    await boards.raiseScore(write("user_a", 40));

    const entries = await boards.listForPlayer("user_a");

    expect(entries).toEqual([
      {
        board: "xp",
        period: "all",
        playerId: "user_a",
        displayName: "user_a",
        level: 2,
        score: 40,
        updatedAt: T0,
      },
    ]);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(await boards.removePlayer("user_a")).toBe(1);
    expect(await boards.listForPlayer("user_a")).toEqual([]);
  });
});
