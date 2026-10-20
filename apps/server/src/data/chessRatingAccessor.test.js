import { describe, expect, it } from "vitest";
import { createInMemoryChessRatingDao } from "../testing/inMemoryChessRatingDao.js";
import { ConcurrentChangeError, ConflictError } from "../utils/errors.js";
import { createChessRatingAccessor } from "./chessRatingAccessor.js";

const AT = Date.UTC(2026, 9, 20, 12);
const START = Object.freeze({ rating: 1500, deviation: 350, volatility: 0.06 });

function setup() {
  const dao = createInMemoryChessRatingDao();
  return { dao, ratings: createChessRatingAccessor({ chessRatingDao: dao }) };
}

/** A rating after one game, as the domain hands it to `save`. */
const afterOneGame = (rating, overrides = {}) => ({
  ...rating,
  rating: 1662.3,
  deviation: 290.3,
  games: 1,
  lastRatedAt: AT,
  changes: [
    { matchId: "m1", at: AT, before: { ...START }, after: { ...START, rating: 1662.3, deviation: 290.3 } },
  ],
  ...overrides,
});

describe("chessRatingAccessor", () => {
  it("answers the starting rating at revision 0 for a player with none", async () => {
    const { ratings } = setup();

    expect(await ratings.get("guest_a")).toEqual({
      playerId: "guest_a",
      ...START,
      games: 0,
      lastRatedAt: 0,
      changes: [],
      mergedFrom: [],
      revision: 0,
    });
  });

  it("saves a rating and reads it back in milliseconds, at the next revision", async () => {
    const { ratings } = setup();
    const saved = afterOneGame(await ratings.get("guest_a"));

    await ratings.save({ rating: saved, at: AT });

    expect(await ratings.get("guest_a")).toEqual({ ...saved, revision: 1 });
  });

  it("keeps a seed and a superseded change", async () => {
    const { ratings } = setup();
    const start = await ratings.get("guest_a");
    const saved = {
      ...afterOneGame(start),
      seed: { level: "hard", at: AT },
      changes: afterOneGame(start).changes.map((change) => ({ ...change, superseded: true })),
    };

    await ratings.save({ rating: saved, at: AT });

    expect(await ratings.get("guest_a")).toEqual({ ...saved, revision: 1 });
  });

  it("refuses a save based on a rating that changed since it was read", async () => {
    const { ratings } = setup();
    const read = await ratings.get("guest_a");
    await ratings.save({ rating: afterOneGame(read), at: AT });

    await expect(ratings.save({ rating: afterOneGame(read, { rating: 1400 }), at: AT })).rejects.toThrow(
      ConcurrentChangeError,
    );
  });

  it("reads the account's rating for a guest who moved into it", async () => {
    const { ratings } = setup();
    await ratings.save({ rating: afterOneGame(await ratings.get("user_b")), at: AT });
    await ratings.markMerged({ from: "guest_a", to: "user_b", at: AT });

    expect(await ratings.get("guest_a")).toMatchObject({ playerId: "user_b", games: 1, revision: 1 });
  });

  it("answers what a guest held when marking it as moved, and refuses a second account", async () => {
    const { ratings } = setup();
    await ratings.save({ rating: afterOneGame(await ratings.get("guest_a")), at: AT });

    const guest = await ratings.markMerged({ from: "guest_a", to: "user_b", at: AT });

    expect(guest).toMatchObject({ playerId: "guest_a", games: 1, rating: 1662.3 });
    await expect(ratings.markMerged({ from: "guest_a", to: "user_c", at: AT })).rejects.toThrow(
      ConflictError,
    );
  });

  it("removes a player's rating and the markers pointing at it", async () => {
    const { ratings } = setup();
    await ratings.save({ rating: afterOneGame(await ratings.get("user_b")), at: AT });
    await ratings.markMerged({ from: "guest_a", to: "user_b", at: AT });

    expect(await ratings.removePlayer("user_b")).toBe(2);
    expect((await ratings.get("user_b")).revision).toBe(0);
  });

  it("passes other storage failures through", async () => {
    const failing = createChessRatingAccessor({
      chessRatingDao: {
        getByPlayer: async () => {
          throw new Error("down");
        },
        write: async () => {
          throw new Error("down");
        },
        markMergedInto: async () => {
          throw new Error("down");
        },
      },
    });

    await expect(failing.get("guest_a")).rejects.toThrow("down");
    const unsaved = afterOneGame({ ...START, playerId: "guest_a", mergedFrom: [], revision: 0 });
    await expect(failing.save({ rating: unsaved, at: AT })).rejects.toThrow("down");
    await expect(failing.markMerged({ from: "guest_a", to: "user_b", at: AT })).rejects.toThrow("down");
  });
});
