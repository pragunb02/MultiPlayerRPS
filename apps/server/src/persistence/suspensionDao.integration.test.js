import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { runSuspensionDaoContract } from "../testing/suspensionDaoContract.js";
import { connectDatabase } from "./database.js";
import { createSuspensionDao } from "./suspensionDao.js";

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
    uri: mongo.uri(`suspensions-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createSuspensionDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB suspension DAO honours the suspension DAO contract (integration)", () => {
  runSuspensionDaoContract(createDao);

  it("keeps a suspension until 180 days after it ended or was lifted (TTL), and never while it lasts", async () => {
    await createDao();

    const indexes = await databases.at(-1).connection.db.collection("account_suspensions").indexes();

    // MongoDB removes a document at its own `deleteAt`. One until lifted has none until it is lifted, and a TTL
    // index never removes a document without the field.
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { deleteAt: 1 }, expireAfterSeconds: 0 }),
        expect.objectContaining({ key: { suspensionId: 1 }, unique: true }),
        expect.objectContaining({ key: { playerId: 1, startedAt: -1 } }),
        expect.objectContaining({ key: { liftedAt: 1, endsAt: 1 } }),
        expect.objectContaining({
          key: { activeFor: 1 },
          unique: true,
          partialFilterExpression: { activeFor: { $type: "string" } },
        }),
      ]),
    );
  });
});
