import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { runProgressDaoContract } from "../testing/progressDaoContract.js";
import { connectDatabase } from "./database.js";
import { createProgressDao } from "./progressDao.js";

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
    uri: mongo.uri(`progress-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createProgressDao({ connection: database.connection });
  await dao.ensureIndexes();
  return dao;
}

describe("MongoDB progress DAO honours the progress DAO contract (integration)", () => {
  runProgressDaoContract(createDao);

  it("stays exactly-once when the same match is applied concurrently", async () => {
    const dao = await createDao();
    const inc = { xp: 30, matchesPlayed: 1, wins: 1 };
    const at = new Date();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => dao.applyMatchOnce({ playerId: "guest_a", matchId: "m1", inc, at })),
    );

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect((await dao.getByPlayer("guest_a")).xp).toBe(30);
  });

  it("does not lose XP when different matches arrive at once for a brand-new player", async () => {
    const dao = await createDao();
    const inc = { xp: 10, matchesPlayed: 1, losses: 1 };
    const at = new Date();

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        dao.applyMatchOnce({ playerId: "guest_new", matchId: `m${i}`, inc, at }),
      ),
    );

    expect(results.every((r) => r.applied)).toBe(true);
    expect(await dao.getByPlayer("guest_new")).toEqual(
      expect.objectContaining({ xp: 100, matchesPlayed: 10 }),
    );
  });
});
