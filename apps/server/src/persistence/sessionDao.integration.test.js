import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { runSessionDaoContract } from "../testing/sessionDaoContract.js";
import { connectDatabase } from "./database.js";
import { createSessionDao } from "./sessionDao.js";
import { createSessionStore, SESSION_COLLECTION } from "./sessionStore.js";

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

async function createPair() {
  const database = await connectDatabase({
    uri: mongo.uri(`sessions-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const store = await createSessionStore({ client: database.client, ttlSeconds: 60 });
  return { store, database, dao: createSessionDao({ client: database.client }) };
}

describe("MongoDB session DAO honours the session DAO contract over the real session store (integration)", () => {
  runSessionDaoContract(createPair);
});

describe("MongoDB session DAO indexes (integration)", () => {
  it("finds a player's sessions by an index, so the devices list reads no other sessions (CC-262)", async () => {
    const { dao, database } = await createPair();

    await dao.ensureIndexes();
    await dao.ensureIndexes();

    const indexes = await database.client.db().collection(SESSION_COLLECTION).indexes();
    expect(indexes.map((index) => index.key)).toContainEqual({ "session.identity.id": 1 });
  });
});
