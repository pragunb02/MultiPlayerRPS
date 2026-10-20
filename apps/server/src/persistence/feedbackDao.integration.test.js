import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEEDBACK_KEEP_DAYS } from "@classicade/shared";
import { feedbackRecord, runFeedbackDaoContract } from "../testing/feedbackDaoContract.js";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { connectDatabase } from "./database.js";
import { createFeedbackDao } from "./feedbackDao.js";

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
    uri: mongo.uri(`feedback-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createFeedbackDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB feedback DAO honours the feedback DAO contract (integration)", () => {
  runFeedbackDaoContract(createDao);

  it("writes to a new `feedback` collection and to no other", async () => {
    const dao = await createDao();

    await dao.insert(feedbackRecord());

    const names = (await databases.at(-1).connection.db.listCollections().toArray()).map((c) => c.name);
    expect(names).toEqual(["feedback"]);
  });

  it("removes items 180 days after they were sent (TTL), and indexes the id (unique) and the newest first order", async () => {
    await createDao();

    const indexes = await databases.at(-1).connection.db.collection("feedback").indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { feedbackId: 1 }, unique: true }),
        expect.objectContaining({
          key: { createdAt: 1 },
          expireAfterSeconds: FEEDBACK_KEEP_DAYS * 24 * 60 * 60,
        }),
        expect.objectContaining({ key: { createdAt: -1, feedbackId: -1 } }),
      ]),
    );
  });

  it("stores no Mongo id or version field beside the record", async () => {
    const dao = await createDao();
    const item = feedbackRecord();

    await dao.insert(item);

    const raw = await databases.at(-1).connection.db.collection("feedback").findOne({});
    expect(Object.keys(raw).sort()).toEqual(["_id", ...Object.keys(item)].sort());
  });
});
