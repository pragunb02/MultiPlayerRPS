import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { runChessRatingDaoContract } from "../testing/chessRatingDaoContract.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { createChessRatingDao } from "./chessRatingDao.js";
import { connectDatabase } from "./database.js";
import { VersionConflict } from "./errors.js";

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
    uri: mongo.uri(`chess-ratings-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  return database;
}

async function createDao() {
  const dao = createChessRatingDao({ connection: (await connect()).connection });
  await dao.ensureIndexes();
  return dao;
}

const doc = (rating) => ({
  rating,
  deviation: 350,
  volatility: 0.06,
  games: 0,
  changes: [],
  mergedFrom: [],
  updatedAt: new Date(),
});

describe("MongoDB chess rating DAO honours the chess rating DAO contract (integration)", () => {
  runChessRatingDaoContract(createDao);

  it("lets exactly one of many writes at the same revision through", async () => {
    const dao = await createDao();
    await dao.write({ playerId: "guest_a", revision: 0, doc: doc(1500) });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        dao.write({ playerId: "guest_a", revision: 1, doc: doc(1600 + i) }),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.reason instanceof VersionConflict)).toHaveLength(9);
    expect((await dao.getByPlayer("guest_a")).revision).toBe(2);
  });

  it("lets exactly one of many first writes create the rating", async () => {
    const dao = await createDao();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        dao.write({ playerId: "guest_new", revision: 0, doc: doc(1500 + i) }),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.reason instanceof VersionConflict)).toHaveLength(9);
  });

  it("passes database errors other than a duplicate through", async () => {
    const dao = await createDao();

    await expect(
      dao.write({ playerId: "guest_a", revision: 0, doc: { ...doc(1500), rating: "high" } }),
    ).rejects.toThrow(/Cast/);
    await expect(dao.markMergedInto({ from: "guest_a", to: { $bad: 1 }, at: new Date() })).rejects.toThrow();
  });

  it("keeps one rating per player with a unique index, in the chess_ratings collection", async () => {
    const database = await connect();
    await createChessRatingDao({ connection: database.connection }).ensureIndexes();

    const indexes = await database.connection.db.collection("chess_ratings").indexes();

    expect(indexes.find((index) => index.key.playerId === 1)).toMatchObject({ unique: true });
    expect(indexes.find((index) => index.key.mergedInto === 1)).toMatchObject({ sparse: true });
  });
});
