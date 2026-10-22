import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { databaseUri, ownDatabaseNext } from "../testing/sharedDatabase.js";
import { runPlayerTransferDaoContract } from "../testing/playerTransferDaoContract.js";
import { connectDatabase } from "./database.js";
import { DuplicateKey } from "./errors.js";
import { createPlayerTransferDao } from "./playerTransferDao.js";

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
    uri: await databaseUri(mongo, "transfers"),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createPlayerTransferDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB player transfer DAO honours the player transfer DAO contract (integration)", () => {
  runPlayerTransferDaoContract(createDao);

  it("passes other database errors through instead of calling them duplicates", async () => {
    const dao = await createDao();

    const error = await dao
      .insertPending({ from: "guest_a", to: {}, createdAt: new Date() })
      .catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
  });

  it("indexes transfers by guest (unique) and by status and age", async () => {
    // A database of its own: the file's shared one has its indexes from an earlier test.
    ownDatabaseNext();
    await createDao();

    const indexes = await databases.at(-1).connection.db.collection("player_transfers").indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { from: 1 }, unique: true }),
        expect.objectContaining({ key: { status: 1, createdAt: 1 } }),
      ]),
    );
  });
});
