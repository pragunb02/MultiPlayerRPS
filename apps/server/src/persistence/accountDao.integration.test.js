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

async function connected() {
  const database = await connectDatabase({
    uri: mongo.uri(`accounts-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createAccountDao({ connection: database.connection });
  await dao.ensureIndexes();
  return { dao, database };
}

const createDao = async () => (await connected()).dao;

describe("MongoDB account DAO honours the account DAO contract (integration)", () => {
  runAccountDaoContract(createDao);

  // The duplicate checks rest on these two indexes, built at boot by `ensureIndexes` (CC-245).
  it("has unique indexes on the email and on the lower-cased username in MongoDB", async () => {
    const { database } = await connected();

    const indexes = await database.connection.db.collection("accounts").indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { email: 1 }, unique: true }),
        expect.objectContaining({ key: { usernameKey: 1 }, unique: true }),
      ]),
    );
  });

  it("passes other database errors through instead of calling them duplicates", async () => {
    const dao = await createDao();

    const error = await dao
      .insert({ username: "Riya", email: "riya@example.com", passwordHash: "x", createdAt: "not a date" })
      .catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
  });

  it("reads an account stored before session versions existed as version 0, and counts it up from there (CC-116)", async () => {
    const { dao, database } = await connected();
    const { insertedId } = await database.connection.db.collection("accounts").insertOne({
      username: "Old",
      usernameKey: "old",
      email: "old@example.com",
      passwordHash: "scrypt$x",
      createdAt: new Date(0),
    });
    const accountId = insertedId.toHexString();

    expect((await dao.getById(accountId)).sessionVersion).toBe(0);
    expect(await dao.getSessionVersion(accountId)).toBe(0);
    expect(await dao.bumpSessionVersion({ accountId })).toBe(1);
  });
});
