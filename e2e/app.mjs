// One app process for the browser tests: the real server in production configuration with the built web app.
// server.mjs starts it, and starts it again whenever it stops (serverControl.js).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../apps/server/src/config/index.js";
import { handleShutdownSignals, startServer } from "../apps/server/src/server.js";
import { createLogger } from "../apps/server/src/utils/logger.js";
import { E2E_PORT } from "./personas.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = loadConfig({
  // Secure cookies and proxy trust, as on Render. The tests send X-Forwarded-Proto: https.
  NODE_ENV: "production",
  PORT: String(E2E_PORT),
  LOG_LEVEL: "warn",
  MONGO_URI: process.env.E2E_MONGO_URI,
  SESSION_SECRET: "e2e-session-secret-not-used-anywhere-else-0123456789",
  ALLOWED_ORIGINS: `http://localhost:${E2E_PORT}`,
  WEB_DIST_DIR: path.join(root, "apps/web/dist"),
});
const logger = createLogger({ level: config.logLevel });
// Every test player connects from 127.0.0.1, so the per-IP limits would trip. The per-email limit stays real.
const limits = {
  auth: {
    perIp: { windowMs: 60_000, limit: 10_000 },
    failedLoginsPerEmail: { windowMs: 15 * 60 * 1000, limit: 5 },
  },
  guest: { windowMs: 60_000, limit: 10_000 },
  leaderboard: { windowMs: 60_000, limit: 10_000 },
};
// Standard room lifetimes, unless a test asked the next process for short ones (CC-101).
const rooms = JSON.parse(process.env.E2E_ROOMS);
const { close } = await startServer({ config, logger, limits, rooms });
handleShutdownSignals({ close, logger });
