import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasPlayerIdShape } from "../models/playerIdShape.js";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { DAY_AT, dailyRow, runTelemetryDailyDaoContract } from "../testing/telemetryDailyDaoContract.js";
import { connectDatabase } from "./database.js";
import {
  createTelemetryDailyDao,
  TELEMETRY_DAILY_KEEP_DAYS,
  TELEMETRY_RUNS_KEEP_DAYS,
} from "./telemetryDailyDao.js";

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
    uri: mongo.uri(`telemetry-daily-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createTelemetryDailyDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

const collection = (name) => databases.at(-1).connection.db.collection(name);
const DAY_S = 24 * 60 * 60;

describe("MongoDB telemetry daily DAO honours the telemetry daily DAO contract (integration)", () => {
  runTelemetryDailyDaoContract(createDao);

  // AC-5 (CC-176)
  it("keeps totals 13 months", async () => {
    const dao = await createDao();
    await dao.replaceDay({
      day: "2026-10-19",
      at: new Date(DAY_AT),
      rows: [dailyRow({ group: { route: "/", control: "home.play_guest" }, count: 12 })],
    });

    expect(await collection("telemetry_daily").indexes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { day: 1, event: 1, key: 1 }, unique: true }),
        expect.objectContaining({ key: { at: 1 }, expireAfterSeconds: TELEMETRY_DAILY_KEEP_DAYS * DAY_S }),
      ]),
    );
    expect(TELEMETRY_DAILY_KEEP_DAYS).toBe(400);
    expect(await collection("telemetry_daily_runs").indexes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { at: 1 }, expireAfterSeconds: TELEMETRY_RUNS_KEEP_DAYS * DAY_S }),
      ]),
    );
    // A total and its group, the day, and nothing that names anyone.
    const [doc] = await collection("telemetry_daily").find().toArray();
    expect(Object.keys(doc).sort()).toEqual(["_id", "at", "count", "day", "event", "group", "key"]);
    expect(doc._id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Object.values(doc).filter(hasPlayerIdShape)).toEqual([]);
    // The same group twice on one day is refused by the unique key.
    await expect(collection("telemetry_daily").insertOne({ ...doc, _id: "another" })).rejects.toThrow(
      /duplicate key/,
    );
  });
});
