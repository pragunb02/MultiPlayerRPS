import { expect, it } from "vitest";
import { DuplicateKey, VersionConflict } from "../persistence/errors.js";

const AT = new Date(Date.UTC(2026, 9, 20, 12));
const LATER = new Date(Date.UTC(2026, 9, 20, 13));
const START = Object.freeze({ rating: 1500, deviation: 350, volatility: 0.06 });

/** The stored fields of a rating, as the accessor writes them. */
const ratingDoc = (overrides = {}) => ({
  ...START,
  games: 0,
  changes: [],
  mergedFrom: [],
  updatedAt: AT,
  ...overrides,
});
const change = (matchId, after = {}) => ({
  matchId,
  at: AT,
  before: { ...START },
  after: { rating: 1662.3, deviation: 290.3, volatility: 0.059999, ...after },
});

/**
 * Behaviour every chess rating DAO must have (the MongoDB DAO and the in-memory double), so the double used by the
 * unit tests can never drift from the real one (ENGINEERING.md §4 rule 5).
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/chessRatingDao.js").createChessRatingDao>>} createDao
 */
export function runChessRatingDaoContract(createDao) {
  it("has no rating for a player who never had one", async () => {
    const dao = await createDao();

    await expect(dao.getByPlayer("guest_a")).rejects.toThrow(RangeError);
  });

  it("creates a player's rating at revision 1 and reads it back", async () => {
    const dao = await createDao();
    const doc = ratingDoc({ games: 1, lastRatedAt: AT, changes: [change("m1")] });

    await dao.write({ playerId: "guest_a", revision: 0, doc });

    expect(await dao.getByPlayer("guest_a")).toEqual({ playerId: "guest_a", revision: 1, ...doc });
  });

  it("refuses to create a rating that exists already", async () => {
    const dao = await createDao();
    await dao.write({ playerId: "guest_a", revision: 0, doc: ratingDoc() });

    await expect(dao.write({ playerId: "guest_a", revision: 0, doc: ratingDoc() })).rejects.toThrow(
      VersionConflict,
    );
  });

  it("replaces a rating written at the revision read, and counts the revision up", async () => {
    const dao = await createDao();
    await dao.write({ playerId: "guest_a", revision: 0, doc: ratingDoc() });
    const doc = ratingDoc({
      rating: 1600,
      games: 1,
      lastRatedAt: LATER,
      changes: [change("m1")],
      updatedAt: LATER,
    });

    await dao.write({ playerId: "guest_a", revision: 1, doc });

    expect(await dao.getByPlayer("guest_a")).toEqual({ playerId: "guest_a", revision: 2, ...doc });
  });

  it("refuses a write based on a revision that moved on, and keeps the newer one", async () => {
    const dao = await createDao();
    await dao.write({ playerId: "guest_a", revision: 0, doc: ratingDoc() });
    await dao.write({ playerId: "guest_a", revision: 1, doc: ratingDoc({ rating: 1600 }) });

    await expect(
      dao.write({ playerId: "guest_a", revision: 1, doc: ratingDoc({ rating: 1400 }) }),
    ).rejects.toThrow(VersionConflict);
    expect((await dao.getByPlayer("guest_a")).rating).toBe(1600);
  });

  it("keeps the seed and the superseded mark of a change", async () => {
    const dao = await createDao();
    const doc = ratingDoc({
      rating: 1800,
      seed: { level: "hard", at: AT },
      changes: [{ ...change("m1"), superseded: true }],
    });

    await dao.write({ playerId: "guest_a", revision: 0, doc });

    expect(await dao.getByPlayer("guest_a")).toEqual({ playerId: "guest_a", revision: 1, ...doc });
  });

  it("marks a guest's rating as moved, keeping what it held, and refuses writes to it after", async () => {
    const dao = await createDao();
    const doc = ratingDoc({ rating: 1600, games: 3, changes: [change("m1")] });
    await dao.write({ playerId: "guest_a", revision: 0, doc });

    const marked = await dao.markMergedInto({ from: "guest_a", to: "user_b", at: LATER });

    expect(marked).toEqual({
      playerId: "guest_a",
      revision: 2,
      ...doc,
      mergedInto: "user_b",
      updatedAt: LATER,
    });
    await expect(dao.write({ playerId: "guest_a", revision: 2, doc })).rejects.toThrow(VersionConflict);
  });

  it("leaves a marker for a guest who had no rating, so a late game still finds the account", async () => {
    const dao = await createDao();

    const marked = await dao.markMergedInto({ from: "guest_a", to: "user_b", at: AT });

    expect(marked).toMatchObject({ playerId: "guest_a", games: 0, mergedInto: "user_b", changes: [] });
    expect((await dao.getByPlayer("guest_a")).mergedInto).toBe("user_b");
  });

  it("marks a guest for the same account again without change, and refuses another account", async () => {
    const dao = await createDao();
    const first = await dao.markMergedInto({ from: "guest_a", to: "user_b", at: AT });

    const again = await dao.markMergedInto({ from: "guest_a", to: "user_b", at: LATER });

    expect(again).toEqual(first);
    await expect(dao.markMergedInto({ from: "guest_a", to: "user_c", at: AT })).rejects.toThrow(DuplicateKey);
  });

  it("deletes a player's rating and the markers of the guests who moved into it", async () => {
    const dao = await createDao();
    await dao.write({ playerId: "user_b", revision: 0, doc: ratingDoc() });
    await dao.markMergedInto({ from: "guest_a", to: "user_b", at: AT });
    await dao.write({ playerId: "guest_c", revision: 0, doc: ratingDoc() });

    expect(await dao.deleteByPlayer("user_b")).toBe(2);

    await expect(dao.getByPlayer("user_b")).rejects.toThrow(RangeError);
    await expect(dao.getByPlayer("guest_a")).rejects.toThrow(RangeError);
    expect((await dao.getByPlayer("guest_c")).playerId).toBe("guest_c");
    expect(await dao.deleteByPlayer("user_b")).toBe(0);
  });
}
