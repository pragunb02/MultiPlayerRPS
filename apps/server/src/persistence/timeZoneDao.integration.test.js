import { afterAll, beforeAll, describe } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { runTimeZoneDaoContract } from "../testing/timeZoneDaoContract.js";
import { connectDatabase } from "./database.js";
import { createTimeZoneDao } from "./timeZoneDao.js";

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
    uri: mongo.uri(`time-zones-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createTimeZoneDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB time zone DAO (CC-146)", () => {
  runTimeZoneDaoContract(createDao);
});
