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
        // One challenge per place for open challenges of each sender (CC-337).
        expect.objectContaining({
          key: { fromId: 1, openSlot: 1 },
          unique: true,
          partialFilterExpression: { openSlot: { $exists: true } },
        }),
        expect.objectContaining({
          key: { fromId: 1, toId: 1 },
          unique: true,
          partialFilterExpression: { recentTo: { $exists: true } },
        }),
        expect.objectContaining({ key: { deleteAt: 1 }, expireAfterSeconds: 0 }),
      ]),
    );
  });

  it("starts after a rollback left two holders of one place or mark: the oldest keeps it (CC-337)", async () => {
    // A server without the unique indexes (a rollback) can store two of each. The next start must still build them.
    const database = await connectDatabase({
      uri: mongo.uri(`challenges-${++counter}`),
      logger: captureLogger().logger,
    });
    databases.push(database);
    const RIYA = "user_0123456789abcdef01234567";
    const ARJUN = "user_ffffffffffffffffffffffff";
    const placeA = challengeRecord({ fromId: RIYA, openSlot: 0, seconds: 0 });
    const placeB = challengeRecord({ fromId: RIYA, openSlot: 0, seconds: 5 });
    const markA = {
      ...challengeRecord({ fromId: RIYA, toId: ARJUN, openSlot: 1, seconds: 1 }),
      recentTo: true,
    };
    const markB = {
      ...challengeRecord({ fromId: RIYA, toId: ARJUN, openSlot: 2, seconds: 6 }),
      recentTo: true,
    };
    const other = challengeRecord({ fromId: ARJUN, openSlot: 0, seconds: 7 });
    await database.connection.db.collection("challenges").insertMany([placeB, markB, placeA, markA, other]);
    const dao = createChallengeDao({ connection: database.connection });

    await dao.ensureIndexes();

    const held = async ({ challengeId }) => {
      const { openSlot, recentTo } = await dao.get(challengeId);
      return { openSlot, recentTo };
    };
    expect(await Promise.all([placeA, placeB, markA, markB, other].map(held))).toEqual([
      { openSlot: 0, recentTo: undefined },
      { openSlot: undefined, recentTo: undefined },
      { openSlot: 1, recentTo: true },
      { openSlot: 2, recentTo: undefined },
      { openSlot: 0, recentTo: undefined },
    ]);
    await expect(dao.insert(challengeRecord({ fromId: RIYA, openSlot: 0 }))).rejects.toMatchObject({
      field: "openSlot",
    });
  });
});
