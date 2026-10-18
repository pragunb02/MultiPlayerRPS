import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { runPendingMatchDaoContract } from "../testing/pendingMatchDaoContract.js";
import { connectDatabase } from "./database.js";
import { createPendingMatchDao } from "./pendingMatchDao.js";

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

async function connect() {
  const database = await connectDatabase({
    uri: mongo.uri(`pending-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  return database;
}

async function createDao() {
  const dao = createPendingMatchDao({ connection: (await connect()).connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB pending match DAO honours the pending match DAO contract (integration)", () => {
  runPendingMatchDaoContract(createDao);

  it("lets MongoDB forget a done record when its time is up, and never a failed one", async () => {
    const { connection } = await connect();
    await createPendingMatchDao({ connection }).ensureIndexes();

    const indexes = await connection.db.collection("pending_matches").indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "match_id_unique", unique: true }),
        expect.objectContaining({ name: "status_next_attempt" }),
        expect.objectContaining({ name: "expires_at_ttl", key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
      ]),
    );
  });

  it("treats two adds of the same game at the same moment as one", async () => {
    const dao = await createDao();
    const doc = { matchId: "m1", match: {}, createdAt: new Date(), nextAttemptAt: new Date() };

    const added = await Promise.all(Array.from({ length: 5 }, () => dao.insertIfAbsent(doc)));

    expect(added.filter(Boolean)).toHaveLength(1);
  });

  it("passes other database errors through", async () => {
    const database = await connect();
    const dao = createPendingMatchDao({ connection: database.connection });
    await database.close();

    await expect(
      dao.insertIfAbsent({ matchId: "m1", match: {}, createdAt: new Date(), nextAttemptAt: new Date() }),
    ).rejects.toThrow();
  });
});
