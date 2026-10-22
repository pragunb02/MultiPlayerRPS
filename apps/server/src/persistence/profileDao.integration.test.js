import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { databaseUri, ownDatabaseNext } from "../testing/sharedDatabase.js";
import { runProfileDaoContract } from "../testing/profileDaoContract.js";
import { connectDatabase } from "./database.js";
import { DuplicateKey } from "./errors.js";
import { createProfileDao } from "./profileDao.js";

let mongo;
const databases = [];

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await Promise.all(databases.map((db) => db.close()));
  await mongo?.stop();
});

async function createDao() {
  const database = await connectDatabase({
    uri: await databaseUri(mongo, "profiles"),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createProfileDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB profile DAO honours the profile DAO contract (integration)", () => {
  runProfileDaoContract(createDao);

  it("passes other database errors through instead of calling them duplicates", async () => {
    const dao = await createDao();

    const error = await dao.insert({ playerId: "user_x" }).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
  });

  it("indexes profiles by player and by handle, both unique, in their own new collection", async () => {
    // A database of its own: the file's shared one has its indexes from an earlier test.
    ownDatabaseNext();
    await createDao();

    const indexes = await databases.at(-1).connection.db.collection("player_profiles").indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { playerId: 1 }, unique: true }),
        expect.objectContaining({ key: { handle: 1 }, unique: true }),
      ]),
    );
  });
});
