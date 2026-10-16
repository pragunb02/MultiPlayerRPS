import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { roomDoc, runRoomDaoContract } from "../testing/roomDaoContract.js";
import { connectDatabase } from "./database.js";
import { DuplicateKey } from "./errors.js";
import { createRoomDao } from "./roomDao.js";

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

async function connected() {
  const database = await connectDatabase({
    uri: mongo.uri(`rooms-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createRoomDao({ connection: database.connection });
  await dao.ensureIndexes();
  return { dao, database };
}

const createDao = async () => (await connected()).dao;

describe("MongoDB room DAO honours the room DAO contract (integration)", () => {
  runRoomDaoContract(createDao);

  it("passes other database errors through instead of calling them duplicates", async () => {
    const { dao, database } = await connected();
    await database.connection.db.command({
      collMod: "rooms",
      validator: { status: { $type: "string" } },
    });

    const error = await dao.insert(roomDoc({ status: 7 })).catch((err) => err);

    expect(error).toBeInstanceOf(mongoose.mongo.MongoServerError);
    expect(error).not.toBeInstanceOf(DuplicateKey);
  });

  it("keeps rooms in MongoDB, where a new connection finds them", async () => {
    const { dao, database } = await connected();
    await dao.insert(roomDoc());
    const again = createRoomDao({ connection: database.connection });

    expect(await again.get("ROOM22")).toEqual({ ...roomDoc(), version: 1 });
  });

  it("reads a room caught in the middle of closing as closed, never as missing", async () => {
    const { dao, database } = await connected();
    await dao.insert(roomDoc());
    await dao.insert(roomDoc({ code: "ROOM33" }));
    // What a process that stopped after the first step of closing leaves behind.
    const record = { code: "ROOM22", gameId: "rps", reason: "expired", closedAt: 1_000 };
    await database.connection.db
      .collection("rooms")
      .updateOne({ code: "ROOM22" }, { $set: { closing: record }, $inc: { version: 1 } });

    expect(await dao.has("ROOM22")).toBe(false);
    await expect(dao.get("ROOM22")).rejects.toThrow(RangeError);
    await expect(dao.update({ ...roomDoc(), version: 2 })).rejects.toThrow(RangeError);
    await expect(dao.close({ code: "ROOM22", version: 2, record })).rejects.toThrow(RangeError);
    await expect(dao.insert(roomDoc())).rejects.toThrow(DuplicateKey);
    expect(await dao.hasClosed("ROOM22")).toBe(true);
    expect(await dao.getClosed("ROOM22")).toEqual(record);
    expect((await dao.list()).map((doc) => doc.code)).toEqual(["ROOM33"]);
    expect(await dao.deleteClosedBefore(1_001)).toBe(1);
    expect(await dao.hasClosed("ROOM22")).toBe(false);
  });

  it("creates its indexes once and again without complaint", async () => {
    const { dao, database } = await connected();

    await dao.ensureIndexes();
    const names = (await database.connection.db.collection("rooms").indexes()).map((index) => index.name);

    expect(names).toEqual(expect.arrayContaining(["code_unique", "seats_player", "due_at", "expires_at"]));
  });
});
