import { afterAll, beforeAll, describe } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { databaseUri } from "../testing/sharedDatabase.js";
import { runSessionDaoContract } from "../testing/sessionDaoContract.js";
import { connectDatabase } from "./database.js";
import { createSessionDao } from "./sessionDao.js";
import { createSessionStore } from "./sessionStore.js";

let mongo;
const databases = [];

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await Promise.all(databases.map((db) => db.close()));
  await mongo?.stop();
});

describe("MongoDB session DAO honours the session DAO contract over the real session store (integration)", () => {
  runSessionDaoContract(async () => {
    const database = await connectDatabase({
      uri: await databaseUri(mongo, "sessions"),
      logger: captureLogger().logger,
    });
    databases.push(database);
    const store = await createSessionStore({ client: database.client, ttlSeconds: 60 });
    return { store, dao: createSessionDao({ client: database.client }) };
  });
});
