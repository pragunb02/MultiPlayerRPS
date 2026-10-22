import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import {
  runFriendLinkDaoContract,
  runFriendRequestDaoContract,
  runFriendshipDaoContract,
  runPrivacyDaoContract,
} from "../testing/friendDaoContracts.js";
import { startMemoryMongo } from "../testing/memoryMongo.js";
import { databaseUri, ownDatabaseNext } from "../testing/sharedDatabase.js";
import { connectDatabase } from "./database.js";
import { DuplicateKey } from "./errors.js";
import { createFriendLinkDao } from "./friendLinkDao.js";
import { createFriendRequestDao } from "./friendRequestDao.js";
import { createFriendshipDao } from "./friendshipDao.js";
import { createPrivacyDao } from "./privacyDao.js";

// CC-052, ADR-066: the four friends collections, each new. Nothing existing is read or changed.
let mongo;
const databases = [];

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await Promise.all(databases.map((db) => db.close()));
  await mongo?.stop();
});

async function connect() {
  const database = await connectDatabase({
    uri: await databaseUri(mongo, "friends"),
    logger: captureLogger().logger,
  });
  databases.push(database);
  return database;
}

/** A DAO of the given kind on a fresh database, with its indexes built. */
const daoOn = (create) => async () => {
  const dao = create({ connection: (await connect()).connection });
  await dao.ensureIndexes();
  return dao;
};

const indexesOf = (collection) => databases.at(-1).connection.db.collection(collection).indexes();

describe("MongoDB friendship DAO honours the friendship DAO contract (integration)", () => {
  runFriendshipDaoContract(daoOn(createFriendshipDao));

  it("passes other database errors through, and indexes both sides of a pair", async () => {
    // A database of its own: the file's shared one has its indexes from an earlier test.
    ownDatabaseNext();
    const dao = await daoOn(createFriendshipDao)();

    const error = await dao.insert({ low: "user_x" }).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
    expect(await indexesOf("friendships")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { low: 1, high: 1 }, unique: true }),
        expect.objectContaining({ key: { high: 1 } }),
      ]),
    );
  });
});

describe("MongoDB friend request DAO honours the friend request DAO contract (integration)", () => {
  runFriendRequestDaoContract(daoOn(createFriendRequestDao));

  it("passes other database errors through, and lets MongoDB remove a request once it runs out", async () => {
    // A database of its own: the file's shared one has its indexes from an earlier test.
    ownDatabaseNext();
    const dao = await daoOn(createFriendRequestDao)();

    const error = await dao.insert({ requestId: "x" }).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
    expect(await indexesOf("friend_requests")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { senderId: 1, recipientId: 1 }, unique: true }),
        expect.objectContaining({ key: { recipientId: 1, createdAt: -1 } }),
        expect.objectContaining({ key: { requestId: 1 }, unique: true }),
        expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
      ]),
    );
  });
});

describe("MongoDB friend link DAO honours the friend link DAO contract (integration)", () => {
  runFriendLinkDaoContract(daoOn(createFriendLinkDao));

  it("passes other database errors through, and lets MongoDB remove a link once it stops working", async () => {
    // A database of its own: the file's shared one has its indexes from an earlier test.
    ownDatabaseNext();
    const dao = await daoOn(createFriendLinkDao)();

    const error = await dao.insert({ tokenHash: "x" }).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateKey);
    expect(await indexesOf("friend_links")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { tokenHash: 1 }, unique: true }),
        expect.objectContaining({ key: { creatorId: 1, createdAt: -1 } }),
        expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
      ]),
    );
  });
});

describe("MongoDB privacy DAO honours the privacy DAO contract (integration)", () => {
  runPrivacyDaoContract(daoOn(createPrivacyDao));

  it("keeps one document per player", async () => {
    // A database of its own: the file's shared one has its indexes from an earlier test.
    ownDatabaseNext();
    await daoOn(createPrivacyDao)();

    expect(await indexesOf("player_privacy")).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: { playerId: 1 }, unique: true })]),
    );
  });
});
