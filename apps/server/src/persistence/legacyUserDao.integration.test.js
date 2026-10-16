import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { LEGACY_USERS, runLegacyUserDaoContract } from "../testing/legacyUserDaoContract.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { connectDatabase } from "./database.js";
import { createLegacyUserDao } from "./legacyUserDao.js";

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

async function createDao(seed) {
  const database = await connectDatabase({
    uri: mongo.uri(`legacy-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  if (seed.length > 0) {
    await database.connection.db.collection("users").insertMany(seed.map((user) => ({ ...user })));
  }
  return { dao: createLegacyUserDao({ connection: database.connection }), database };
}

describe("MongoDB legacy user DAO honours the legacy user DAO contract (integration)", () => {
  runLegacyUserDaoContract(async (seed) => (await createDao(seed)).dao);

  it("never writes to the legacy collection", async () => {
    const { dao, database } = await createDao(LEGACY_USERS);
    const before = await database.connection.db.collection("users").find().toArray();

    await dao.getByEmail("riya@example.com");

    expect(await database.connection.db.collection("users").find().toArray()).toEqual(before);
    expect(Object.keys(dao)).toEqual(["getByEmail"]);
  });
});
