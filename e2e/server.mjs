// The real server for end-to-end tests: production configuration, the built web app, and a throwaway MongoDB
// seeded with one player from the legacy app. Started by Playwright (playwright.config.js → webServer).
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { loadConfig } from "../apps/server/src/config/index.js";
import { handleShutdownSignals, startServer } from "../apps/server/src/server.js";
import { createLogger } from "../apps/server/src/utils/logger.js";
import { E2E_PORT, LEGACY_PLAYER } from "./personas.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mongo = await MongoMemoryServer.create();
const uri = `${mongo.getUri()}e2e`;

const seed = await mongoose.createConnection(uri).asPromise();
await seed.db.collection("users").insertOne({
  username: LEGACY_PLAYER.legacyUsername,
  email: LEGACY_PLAYER.email,
  password: bcrypt.hashSync(LEGACY_PLAYER.password, 10),
  level: 7,
});
await seed.close();

const config = loadConfig({
  NODE_ENV: "production", // secure cookies and proxy trust, as on Render; the tests send X-Forwarded-Proto: https
  PORT: String(E2E_PORT),
  LOG_LEVEL: "warn",
  MONGO_URI: uri,
  SESSION_SECRET: "e2e-session-secret-not-used-anywhere-else-0123456789",
  ALLOWED_ORIGINS: `http://localhost:${E2E_PORT}`,
  WEB_DIST_DIR: path.join(root, "apps/web/dist"),
});
const logger = createLogger({ level: config.logLevel });
// Every test player connects from 127.0.0.1, so the per-IP limits would trip; the per-email limit stays real.
const limits = {
  auth: {
    perIp: { windowMs: 60_000, limit: 10_000 },
    failedLoginsPerEmail: { windowMs: 15 * 60 * 1000, limit: 5 },
  },
  guest: { windowMs: 60_000, limit: 10_000 },
  leaderboard: { windowMs: 60_000, limit: 10_000 },
};
const { close } = await startServer({ config, logger, limits });
handleShutdownSignals({
  close: async () => {
    await close();
    await mongo.stop();
  },
  logger,
});
