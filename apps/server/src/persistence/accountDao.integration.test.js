import { afterAll, beforeAll, describe } from "vitest";
import { runAccountDaoContract } from "../testing/accountDaoContract.js";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { createAccountDao } from "./accountDao.js";
import { connectDatabase } from "./database.js";

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

describe("MongoDB account DAO honours the account DAO contract (integration)", () => {
  runAccountDaoContract(async () => {
    const database = await connectDatabase({
      uri: mongo.uri(`accounts-${++counter}`),
      logger: captureLogger().logger,
    });
    databases.push(database);
    const dao = createAccountDao({ connection: database.connection });
    await dao.ensureIndexes();
    return dao;
  });
});
