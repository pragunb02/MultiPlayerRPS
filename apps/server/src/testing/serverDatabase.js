import { startServer } from "../server.js";
import { captureLogger } from "./captureLogger.js";
import { testConfig } from "./testConfig.js";

/**
 * Starts a server on a test file's shared database and stops it again, so its collections and indexes are made
 * before the first test, in the file's setup (CC-338). Otherwise the first test pays for all of them, about 110
 * synced to disk, inside its own time limit.
 *
 * @param {{ uri: (dbName: string) => string }} mongo  from startMemoryMongo
 * @param {string} name  the file's database
 */
export async function makeServerDatabase(mongo, name) {
  const app = await startServer({
    config: testConfig({ MONGO_URI: mongo.uri(name) }),
    logger: captureLogger().logger,
  });
  await app.close();
}
