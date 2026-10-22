import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAccountDeletionDaoContract } from "../testing/accountDeletionDaoContract.js";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { databaseUri, ownDatabaseNext } from "../testing/sharedDatabase.js";
import { createAccountDeletionDao } from "./accountDeletionDao.js";
import { connectDatabase } from "./database.js";

let mongo;
const databases = [];

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await Promise.all(databases.map((db) => db.close()));
  await mongo?.stop();
});

async function connected() {
  const database = await connectDatabase({
    uri: await databaseUri(mongo, "deletions"),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createAccountDeletionDao({ connection: database.connection });
  await dao.ensureIndexes();
  return { dao, database };
}

describe("MongoDB account deletion DAO honours the account deletion DAO contract (integration)", () => {
  runAccountDeletionDaoContract(async () => (await connected()).dao);

  it("lets MongoDB remove a deletion record when its time is up, and keeps legacy closures for ever", async () => {
    // A database of its own: the file's shared one has its indexes from an earlier test.
    ownDatabaseNext();
    const { database } = await connected();

    const deletionIndexes = await database.connection.db.collection("account_deletions").indexes();
    const closureIndexes = await database.connection.db.collection("legacy_closures").indexes();

    expect(deletionIndexes).toContainEqual(
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
    );
    expect(deletionIndexes).toContainEqual(expect.objectContaining({ key: { playerId: 1 }, unique: true }));
    expect(closureIndexes).toContainEqual(expect.objectContaining({ key: { legacyId: 1 }, unique: true }));
    expect(closureIndexes.some((index) => index.expireAfterSeconds !== undefined)).toBe(false);
  });

  it("stores the legacy row's id and the time only, never an email", async () => {
    const { dao, database } = await connected();

    await dao.closeLegacy({ legacyId: "64b7f0c2a1b2c3d4e5f60718", closedAt: new Date(0) });

    const [stored] = await database.connection.db.collection("legacy_closures").find().toArray();
    expect(Object.keys(stored).sort()).toEqual(["_id", "closedAt", "legacyId"]);
  });
});
