import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDailyPuzzleAttemptDaoContract } from "../testing/dailyPuzzleAttemptDaoContract.js";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { createDailyPuzzleAttemptDao } from "./dailyPuzzleAttemptDao.js";
import { connectDatabase } from "./database.js";
import { DuplicateKey } from "./errors.js";

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
    uri: mongo.uri(`daily-puzzles-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createDailyPuzzleAttemptDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB daily puzzle attempt DAO honours the contract (integration)", () => {
  runDailyPuzzleAttemptDaoContract(createDao);

  it("passes other database errors through instead of calling them duplicates", async () => {
    const dao = await createDao();

    const error = await dao.insert({ playerId: "a" }).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
  });

  it("passes other database errors through when giving a day to another player", async () => {
    const dao = await createDao();

    const error = await dao
      .reassign({ from: "a", to: { not: "an id" }, kind: "chess", day: "2026-10-20" })
      .catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
  });

  it("has one unique index on player, kind and day, and no other besides _id", async () => {
    await createDao();

    const indexes = await databases.at(-1).connection.db.collection("daily_puzzle_attempts").indexes();

    expect(indexes.map(({ key }) => key)).toEqual([{ _id: 1 }, { playerId: 1, kind: 1, day: 1 }]);
    expect(indexes[1].unique).toBe(true);
  });
});
