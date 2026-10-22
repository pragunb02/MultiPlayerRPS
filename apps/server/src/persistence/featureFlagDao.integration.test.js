import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countRow, runFeatureFlagDaoContract } from "../testing/featureFlagDaoContract.js";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { databaseUri, ownDatabaseNext } from "../testing/sharedDatabase.js";
import { connectDatabase } from "./database.js";
import { createFeatureFlagDao } from "./featureFlagDao.js";

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
    uri: await databaseUri(mongo, "flags"),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createFeatureFlagDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB feature flag DAO honours the feature flag DAO contract (integration)", () => {
  runFeatureFlagDaoContract(createDao);

  it("writes only to the new `feature_flags` and `feature_flag_counts` collections", async () => {
    // A database of its own: the file's shared one has its indexes from an earlier test.
    ownDatabaseNext();
    const dao = await createDao();

    await dao.setOverride({ name: "new_lobby", rollout: 5, updatedAt: new Date() });
    await dao.addCounts([countRow()]);

    const names = (await databases.at(-1).connection.db.listCollections().toArray()).map((c) => c.name);
    expect(names.sort()).toEqual(["feature_flag_counts", "feature_flags"]);
  });

  it("indexes a flag's name once, a day's counts once per flag and side, and removes counts at expiresAt", async () => {
    // A database of its own: the file's shared one has its indexes from an earlier test.
    ownDatabaseNext();
    await createDao();
    const { db } = databases.at(-1).connection;

    expect(await db.collection("feature_flags").indexes()).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: { name: 1 }, unique: true })]),
    );
    expect(await db.collection("feature_flag_counts").indexes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { flag: 1, day: 1, side: 1 }, unique: true }),
        expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
      ]),
    );
  });

  it("stores no id of any player, session or device in the counts", async () => {
    const dao = await createDao();

    await dao.addCounts([countRow({ exposures: 2 })]);

    const [doc] = await databases.at(-1).connection.db.collection("feature_flag_counts").find().toArray();
    expect(Object.keys(doc).sort()).toEqual(
      ["_id", "day", "expiresAt", "exposures", "flag", "side", "successes"].sort(),
    );
  });
});
