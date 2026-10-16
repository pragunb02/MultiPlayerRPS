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
});
