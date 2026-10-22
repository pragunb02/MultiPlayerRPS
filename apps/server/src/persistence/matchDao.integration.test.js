import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { runMatchDaoContract } from "../testing/matchDaoContract.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { databaseUri } from "../testing/sharedDatabase.js";
import { connectDatabase } from "./database.js";
import { DuplicateKey } from "./errors.js";
import { createMatchDao } from "./matchDao.js";

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
    uri: await databaseUri(mongo, "matches"),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createMatchDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB match DAO honours the match DAO contract (integration)", () => {
  runMatchDaoContract(createDao);

  it("passes other database errors through instead of calling them duplicates", async () => {
    const dao = await createDao();

    const error = await dao.insert({ matchId: "m-incomplete" }).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
  });
});
