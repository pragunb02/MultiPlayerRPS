import mongoose from "mongoose";

/**
 * Opens a dedicated MongoDB connection for this app instance (no global mongoose state, so tests
 * and multiple instances never share connections).
 *
 * @param {{ uri: string, logger: import("../utils/logger.js").Logger, serverSelectionTimeoutMS?: number }} options
 * @returns {Promise<{ connection: mongoose.Connection, client: import("mongodb").MongoClient, close: () => Promise<void> }>}
 */
export async function connectDatabase({ uri, logger, serverSelectionTimeoutMS = 10_000 }) {
  const connection = mongoose.createConnection(uri, { serverSelectionTimeoutMS });
  try {
    await connection.asPromise();
  } catch (err) {
    await connection.close().catch(() => {});
    throw new Error("Could not connect to MongoDB", { cause: err });
  }
  logger.info({ database: connection.name }, "database connected");

  return {
    connection,
    client: connection.getClient(),
    close: async () => {
      await connection.close();
      logger.info("database connection closed");
    },
  };
}
