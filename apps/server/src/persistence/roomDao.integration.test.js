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

async function connected(options = {}) {
  const database = await connectDatabase({
    uri: mongo.uri(`rooms-${++counter}`),
    logger: captureLogger().logger,
  });
  databases.push(database);
  const dao = createRoomDao({ connection: database.connection, ...options });
  await dao.ensureIndexes();
  return { dao, database };
}

const createDao = async (options) => (await connected(options)).dao;

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
    const caught = { ...roomDoc(), version: 2 };
    await expect(dao.update({ doc: caught, previous: caught })).rejects.toThrow(RangeError);
    await expect(dao.close({ code: "ROOM22", version: 2, record })).rejects.toThrow(RangeError);
    await expect(dao.insert(roomDoc())).rejects.toThrow(DuplicateKey);
    expect(await dao.hasClosed("ROOM22")).toBe(true);
    expect(await dao.getClosed("ROOM22")).toEqual(record);
    expect((await dao.list()).map((doc) => doc.code)).toEqual(["ROOM33"]);
    expect(await dao.deleteClosedBefore(1_001)).toBe(1);
    expect(await dao.hasClosed("ROOM22")).toBe(false);
  });

  it("saves a move in one round trip that sends the new log entry, not the whole room (CC-182)", async () => {
    const connection = await mongoose
      .createConnection(mongo.uri(`rooms-${++counter}`), { monitorCommands: true })
      .asPromise();
    databases.push(connection);
    const dao = createRoomDao({ connection });
    const longLog = Array.from({ length: 300 }, (_, i) => ({
      kind: "move",
      playerId: "guest_a",
      move: { i },
      at: i,
    }));
    const read = await dao.insert(roomDoc({ game: { ...roomDoc().game, log: longLog } }));
    const entry = { kind: "move", playerId: "guest_b", move: { choice: "paper" }, at: 999 };
    const commands = [];
    connection.getClient().on("commandStarted", (event) => commands.push(event));

    await dao.update({
      doc: { ...read, lastActivityAt: 999, game: { ...read.game, log: [...read.game.log, entry] } },
      previous: read,
    });

    expect(commands.map((event) => event.commandName)).toEqual(["findAndModify"]);
    expect(commands[0].command.update).toEqual({
      $set: { lastActivityAt: 999 },
      $push: { "game.log": { $each: [entry] } },
      $inc: { version: 1 },
    });
  });

  it("finds the rooms whose game deadline has come through the deadline index, never by reading every room (CC-107)", async () => {
    const { dao, database } = await connected();
    for (let i = 0; i < 40; i++) {
      await dao.insert(roomDoc({ code: `WAIT${String(i).padStart(2, "0")}`, status: "waiting", dueAt: 0 }));
    }
    await dao.insert(roomDoc({ code: "FLAG22", dueAt: 5 }));

    const plan = await database.connection.db
      .collection("rooms")
      .find({ dueAt: { $gt: 0, $lte: 10 }, closing: { $exists: false } })
      .explain("executionStats");

    expect((await dao.listDue(10)).map((doc) => doc.code)).toEqual(["FLAG22"]);
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('"indexName":"due_at"');
    expect(plan.executionStats.totalDocsExamined).toBe(1);
  });

  it("creates its indexes once and again without complaint", async () => {
    const { dao, database } = await connected();

    await dao.ensureIndexes();
    const names = (await database.connection.db.collection("rooms").indexes()).map((index) => index.name);

    expect(names).toEqual(expect.arrayContaining(["code_unique", "seats_player", "due_at", "expires_at"]));
  });
});
