import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPORT_KEEP_DAYS } from "@classicade/shared";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { reportRecord, runReportDaoContract } from "../testing/reportDaoContract.js";
import { connectDatabase } from "./database.js";
import { createReportDao } from "./reportDao.js";

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
    uri: mongo.uri(`reports-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createReportDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB report DAO honours the report DAO contract (integration)", () => {
  runReportDaoContract(createDao);

  it("writes to a new `player_reports` collection and to no other", async () => {
    const dao = await createDao();

    await dao.insert(reportRecord());

    const names = (await databases.at(-1).connection.db.listCollections().toArray()).map((c) => c.name);
    expect(names).toEqual(["player_reports"]);
  });

  it("removes reports 180 days after they were made (TTL), and indexes ids, the day's pair, the queue and the player", async () => {
    await createDao();

    const indexes = await databases.at(-1).connection.db.collection("player_reports").indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { reportId: 1 }, unique: true }),
        expect.objectContaining({ key: { reporterId: 1, reportedId: 1, day: 1 }, unique: true }),
        expect.objectContaining({ key: { reportedId: 1, status: 1 } }),
        expect.objectContaining({ key: { status: 1, createdAt: -1 } }),
        expect.objectContaining({
          key: { createdAt: 1 },
          expireAfterSeconds: REPORT_KEEP_DAYS * 24 * 60 * 60,
        }),
      ]),
    );
    expect(indexes).toHaveLength(6);
  });

  it("stores no Mongo version field beside the record", async () => {
    const dao = await createDao();
    const report = reportRecord();

    await dao.insert(report);

    const raw = await databases.at(-1).connection.db.collection("player_reports").findOne({});
    expect(Object.keys(raw).sort()).toEqual(["_id", ...Object.keys(report)].sort());
  });
});
