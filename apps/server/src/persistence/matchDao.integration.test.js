import { afterAll, beforeAll, describe } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { runMatchDaoContract } from "../testing/matchDaoContract.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { connectDatabase } from "./database.js";
import { createMatchDao } from "./matchDao.js";

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

describe("MongoDB match DAO honours the match DAO contract (integration)", () => {
  runMatchDaoContract(async () => {
    const database = await connectDatabase({
      uri: mongo.uri(`matches-${++counter}`),
      logger: captureLogger().logger,
    });
    databases.push(database);
    const dao = createMatchDao({ connection: database.connection });
    await dao.ensureIndexes();
    return dao;
  });
});
