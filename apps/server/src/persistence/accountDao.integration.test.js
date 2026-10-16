import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAccountDaoContract } from "../testing/accountDaoContract.js";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { createAccountDao } from "./accountDao.js";
import { connectDatabase } from "./database.js";
import { DuplicateKey } from "./errors.js";

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
    uri: mongo.uri(`accounts-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createAccountDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB account DAO honours the account DAO contract (integration)", () => {
  runAccountDaoContract(createDao);

  it("passes other database errors through instead of calling them duplicates", async () => {
    const dao = await createDao();

    const error = await dao
      .insert({ username: "Riya", email: "riya@example.com", passwordHash: "x", createdAt: "not a date" })
      .catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
  });
});
