import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { challengeRecord, runChallengeDaoContract } from "../testing/challengeDaoContract.js";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { createChallengeDao } from "./challengeDao.js";
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
    uri: mongo.uri(`challenges-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createChallengeDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB challenge DAO honours the challenge DAO contract (integration)", () => {
  runChallengeDaoContract(createDao);

  it("passes other database errors through instead of calling them duplicates", async () => {
    const dao = await createDao();

    const error = await dao.insert({ challengeId: "x" }).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
  });

  it("keeps options exactly as given, an empty object included", async () => {
    const dao = await createDao();

    const stored = await dao.insert({ ...challengeRecord(), options: {} });

    expect(stored.options).toEqual({});
  });

  it("indexes challenges by id (unique), sender, recipient and taker, and deletes them by themselves", async () => {
    await createDao();

    const indexes = await databases.at(-1).connection.db.collection("challenges").indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { challengeId: 1 }, unique: true }),
        expect.objectContaining({ key: { fromId: 1, createdAt: -1 } }),
        expect.objectContaining({ key: { toId: 1, createdAt: -1 } }),
        expect.objectContaining({ key: { acceptedBy: 1 } }),
        expect.objectContaining({ key: { deleteAt: 1 }, expireAfterSeconds: 0 }),
      ]),
    );
  });
});
