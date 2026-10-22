import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import {
  runAchievementDaoContract,
  runQuestDaoContract,
  runStatsDaoContract,
} from "../testing/gamificationDaoContract.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { databaseUri, ownDatabaseNext } from "../testing/sharedDatabase.js";
import { createAchievementDao } from "./achievementDao.js";
import { connectDatabase } from "./database.js";
import { createQuestDao } from "./questDao.js";
import { createStatsDao } from "./statsDao.js";

let mongo;
const databases = [];

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await Promise.all(databases.map((db) => db.close()));
  await mongo?.stop();
});

async function connect() {
  const database = await connectDatabase({
    uri: await databaseUri(mongo, "gamification"),
    logger: captureLogger().logger,
  });
  databases.push(database);
  return database;
}

/** @param {(deps: { connection: import("mongoose").Connection }) => { ensureIndexes: () => Promise<unknown> }} create */
const factory = (create) => async () => {
  const database = await connect();
  const dao = create({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
};

describe("MongoDB gamification DAOs honour the DAO contracts (integration)", () => {
  runStatsDaoContract(factory(createStatsDao));
  runQuestDaoContract(factory(createQuestDao));
  runAchievementDaoContract(factory(createAchievementDao));

  it("lets exactly one of many concurrent first saves win", async () => {
    const dao = await factory(createStatsDao)();
    const doc = {
      playerId: "guest_a",
      winsByGame: {},
      matchesByGame: {},
      checkmateWins: 0,
      questsCompleted: 0,
      winStreak: { current: 0, best: 0 },
      dailyStreak: { current: 0, best: 0, lastDay: "" },
      recentKeys: [],
      mergedFrom: [],
      updatedAt: new Date(),
    };

    const results = await Promise.all(Array.from({ length: 5 }, () => dao.save({ doc, expectedVersion: 0 })));

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("unlocks an achievement once when the same unlock races", async () => {
    const dao = await factory(createAchievementDao)();
    const unlock = { playerId: "guest_a", achievementId: "first-win", unlockedAt: new Date(), matchId: "m1" };

    const results = await Promise.all(Array.from({ length: 10 }, () => dao.upsertEarliest(unlock)));

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await dao.listByPlayer("guest_a")).toHaveLength(1);
  });

  it("passes database errors other than a duplicate through", async () => {
    const stats = await factory(createStatsDao)();
    const quests = await factory(createQuestDao)();
    const achievements = await factory(createAchievementDao)();

    await expect(stats.save({ doc: { playerId: "guest_a" }, expectedVersion: 0 })).rejects.toThrow();
    await expect(quests.save({ doc: { playerId: "guest_a" }, expectedVersion: 0 })).rejects.toThrow();
    await expect(
      achievements.upsertEarliest({
        playerId: "guest_a",
        achievementId: "x",
        unlockedAt: "soon",
        matchId: "",
      }),
    ).rejects.toThrow();
  });

  it("expires quest days through a TTL index, and keeps one snapshot per player and day", async () => {
    // A database of its own: the file's shared one has its indexes from an earlier test.
    ownDatabaseNext();
    const database = await connect();
    await createQuestDao({ connection: database.connection }).ensureIndexes();

    const indexes = await database.connection.db.collection("player_quests").indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
        expect.objectContaining({ key: { playerId: 1, day: 1 }, unique: true }),
      ]),
    );
  });
});
