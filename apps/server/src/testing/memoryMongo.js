import { MongoMemoryServer } from "mongodb-memory-server";

/**
 * A throwaway MongoDB for integration tests. The first run downloads a mongod binary (cached afterwards).
 *
 * @returns {Promise<{ uri: (dbName: string) => string, stop: () => Promise<void> }>}
 */
export async function startMemoryMongo() {
  const server = await MongoMemoryServer.create();
  return {
    uri: (dbName) => `${server.getUri()}${dbName}`,
    stop: () => server.stop(),
  };
}
