import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

/**
 * A throwaway MongoDB for integration tests. The first run downloads a mongod binary (cached afterwards).
 *
 * Making a collection or an index costs mongod a sync to disk, about 10 to 20 ms each on a quiet Mac and many times
 * that under load, and a server start makes about 110 of them in a new database. A test file that starts many servers
 * can share one database instead: `empty` deletes its documents and keeps its collections and indexes, so the next
 * start makes none (CC-336).
 *
 * @returns {Promise<{
 *   uri: (dbName: string) => string,
 *   empty: (dbName: string) => Promise<void>,
 *   stop: () => Promise<void>,
 * }>}
 */
export async function startMemoryMongo() {
  const server = await MongoMemoryServer.create();
  /** @type {mongoose.Connection | undefined} one connection for `empty`, opened on first use */
  let cleaner;
  return {
    uri: (dbName) => `${server.getUri()}${dbName}`,
    async empty(dbName) {
      cleaner ??= await mongoose.createConnection(server.getUri()).asPromise();
      const db = cleaner.getClient().db(dbName);
      const collections = await db.listCollections({}, { nameOnly: true }).toArray();
      await Promise.all(
        collections
          .filter(({ name, type }) => type === "collection" && !name.startsWith("system."))
          .map(({ name }) => db.collection(name).deleteMany({})),
      );
    },
    // Its own connection closes before mongod stops, so the stop never waits on a client.
    async stop() {
      await cleaner?.close();
      await server.stop();
    },
  };
}
