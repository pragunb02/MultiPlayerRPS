import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { runLeaderboardDaoContract } from "../testing/leaderboardDaoContract.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { connectDatabase } from "./database.js";
import { createLeaderboardDao } from "./leaderboardDao.js";

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
    uri: mongo.uri(`leaderboards-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createLeaderboardDao({ connection: database.connection });
  await dao.ensureIndexes();
  return { dao, database };
}

const AT = new Date(Date.UTC(2026, 9, 16, 12));
const ENTRY = Object.freeze({
  board: "xp",
  period: "all",
  playerId: "user_a",
  displayName: "alice",
  level: 1,
});

describe("MongoDB leaderboard DAO honours the leaderboard DAO contract (integration)", () => {
  runLeaderboardDaoContract(async () => (await connect()).dao);

  it("ends with the highest score when raises race each other", async () => {
    const { dao } = await connect();

    await Promise.all([30, 90, 60, 10].map((score) => dao.raiseScore({ ...ENTRY, score, at: AT })));

    expect((await dao.getEntry(ENTRY)).score).toBe(90);
  });

  it("applies every key exactly once when adds race each other", async () => {
    const { dao } = await connect();

    await Promise.all(["m1", "m2", "m1", "m3"].map((key) => dao.addOnce({ ...ENTRY, key, inc: 10, at: AT })));

    expect((await dao.getEntry(ENTRY)).score).toBe(30);
  });

  it("lets MongoDB expire weekly entries after their expiry time", async () => {
    const { dao, database } = await connect();
    await dao.addOnce({ ...ENTRY, period: "2026-W42", key: "m1", inc: 10, at: AT, expiresAt: AT });
    await dao.raiseScore({ ...ENTRY, period: "2026-W42", score: 40, at: AT, expiresAt: AT });

    const indexes = await database.connection.db.collection("leaderboard_entries").indexes();
    const [stored] = await database.connection.db.collection("leaderboard_entries").find().toArray();

    expect(indexes).toContainEqual(expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }));
    expect(stored).toEqual(expect.objectContaining({ score: 40, expiresAt: AT }));
  });

  it("passes other database errors through", async () => {
    const { dao } = await connect();

    await expect(dao.raiseScore({ ...ENTRY, score: "lots", at: AT })).rejects.toThrow(/Cast/);
    await expect(dao.addOnce({ ...ENTRY, key: "m1", inc: "lots", at: AT })).rejects.toThrow();
  });
});
