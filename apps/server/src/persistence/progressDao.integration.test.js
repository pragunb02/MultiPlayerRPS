import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { runProgressDaoContract } from "../testing/progressDaoContract.js";
import { connectDatabase } from "./database.js";
import { createProgressDao } from "./progressDao.js";

let mongo;
const databases = [];
let counter = 0;

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await Promise.all(databases.map((db) => db.close()));
  await mongo?.stop();
});

async function createDao() {
  const database = await connectDatabase({
    uri: mongo.uri(`progress-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createProgressDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB progress DAO honours the progress DAO contract (integration)", () => {
  runProgressDaoContract(createDao);

  it("passes database errors other than a duplicate through", async () => {
    const dao = await createDao();

    await expect(
      dao.applyMatchOnce({ playerId: "guest_a", matchId: "m1", inc: { xp: "lots" }, at: new Date() }),
    ).rejects.toThrow();
  });

  it("stays exactly-once when the same match is applied concurrently", async () => {
    const dao = await createDao();
    const inc = { xp: 30, matchesPlayed: 1, wins: 1 };
    const at = new Date();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => dao.applyMatchOnce({ playerId: "guest_a", matchId: "m1", inc, at })),
    );

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect((await dao.getByPlayer("guest_a")).xp).toBe(30);
  });

  it("does not lose XP when different matches arrive at once for a brand-new player", async () => {
    const dao = await createDao();
    const inc = { xp: 10, matchesPlayed: 1, losses: 1 };
    const at = new Date();

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        dao.applyMatchOnce({ playerId: "guest_new", matchId: `m${i}`, inc, at }),
      ),
    );

    expect(results.every((r) => r.applied)).toBe(true);
    expect(await dao.getByPlayer("guest_new")).toEqual(
      expect.objectContaining({ xp: 100, matchesPlayed: 10 }),
    );
  });

  it("passes database errors other than a duplicate through when moving a guest", async () => {
    const dao = await createDao();
    const at = new Date();

    await expect(dao.markMergedInto({ from: "guest_a", to: { $bad: 1 }, at })).rejects.toThrow();
    await expect(
      dao.addMerged({ to: "user_1", from: "guest_a", totals: { xp: "lots" }, recentMatchIds: [], at }),
    ).rejects.toThrow();
  });

  it("merges into an account whose progress was stored before guests could move (no mergedFrom yet)", async () => {
    const dao = await createDao();
    await databases
      .at(-1)
      .connection.db.collection("player_progress")
      .insertOne({
        playerId: "user_old",
        xp: 100,
        matchesPlayed: 3,
        recentMatchIds: ["m0"],
        updatedAt: new Date(),
      });
    const totals = { xp: 30, matchesPlayed: 1, wins: 1, losses: 0, draws: 0 };

    const first = await dao.addMerged({
      to: "user_old",
      from: "guest_a",
      totals,
      recentMatchIds: ["m1"],
      at: new Date(),
    });
    const again = await dao.addMerged({
      to: "user_old",
      from: "guest_a",
      totals,
      recentMatchIds: ["m1"],
      at: new Date(),
    });

    expect([first, again]).toEqual([{ applied: true }, { applied: false }]);
    expect((await dao.getByPlayer("user_old")).xp).toBe(130);
  });

  it("marks a brand-new guest once when the move runs twice at the same moment", async () => {
    const dao = await createDao();
    const at = new Date();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => dao.markMergedInto({ from: "guest_new", to: "user_1", at })),
    );

    expect(results.every((r) => r.totals.xp === 0)).toBe(true);
  });

  it("adds a guest once when the move runs twice at the same moment for a brand-new account", async () => {
    const dao = await createDao();
    const at = new Date();
    const totals = { xp: 30, matchesPlayed: 1, wins: 1, losses: 0, draws: 0 };

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        dao.addMerged({ to: "user_new", from: "guest_a", totals, recentMatchIds: ["m1"], at }),
      ),
    );

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect((await dao.getByPlayer("user_new")).xp).toBe(30);
  });
});
