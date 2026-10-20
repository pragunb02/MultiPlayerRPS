import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBlockDaoContract } from "../testing/blockDaoContract.js";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { createBlockDao } from "./blockDao.js";
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
    uri: mongo.uri(`blocks-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createBlockDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB block DAO honours the block DAO contract (integration)", () => {
  runBlockDaoContract(createDao);

  it("passes other database errors through instead of calling them duplicates", async () => {
    const dao = await createDao();

    const error = await dao.insert({ blockId: "x", blockerId: "a" }).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
  });

  it("indexes blocks by pair (unique), by the blocked player and by block id (unique)", async () => {
    await createDao();

    const indexes = await databases.at(-1).connection.db.collection("player_blocks").indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { blockerId: 1, blockedId: 1 }, unique: true }),
        expect.objectContaining({ key: { blockedId: 1 } }),
        expect.objectContaining({ key: { blockId: 1 }, unique: true }),
      ]),
    );
  });
});
