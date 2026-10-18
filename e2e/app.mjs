// One app process for the browser tests: the real server in production configuration with the built web app.
// server.mjs starts it, and starts it again whenever it stops (serverControl.js).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../apps/server/src/config/index.js";
import { handleShutdownSignals, startServer } from "../apps/server/src/server.js";
import { createLogger } from "../apps/server/src/utils/logger.js";
import { OWNER_PLAYER_ID } from "./ownerConsole.js";
import { APP_PORT, BASE_URL } from "./personas.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = loadConfig({
  // Secure cookies and proxy trust, as on Render. tlsFront.js serves HTTPS in front of this process, and the tests
  // send X-Forwarded-Proto: https as Render's proxy does.
  NODE_ENV: "production",
  PORT: String(APP_PORT),
  LOG_LEVEL: "warn",
  MONGO_URI: process.env.E2E_MONGO_URI,
  SESSION_SECRET: "e2e-session-secret-not-used-anywhere-else-0123456789",
  ALLOWED_ORIGINS: BASE_URL,
  WEB_DIST_DIR: path.join(root, "apps/web/dist"),
  // The seeded owner may open the owner console (CC-233, ownerConsole.js).
  ADMIN_ACCOUNT_IDS: OWNER_PLAYER_ID,
});
const logger = createLogger({ level: config.logLevel });
// Every test player connects from 127.0.0.1, so the per-IP limits would trip. The failed-login rules stay real
// (CC-117): they count per email, and every test has its own.
const limits = {
  auth: {
    perIp: { windowMs: 60_000, limit: 10_000 },
    signupPerIp: { windowMs: 60_000, limit: 10_000 },
  },
  guest: { windowMs: 60_000, limit: 10_000 },
  leaderboard: { windowMs: 60_000, limit: 10_000 },
  api: { windowMs: 60_000, limit: 10_000 },
};
// Standard room lifetimes and limits, unless a test asked the next process for others (CC-101, CC-107). The
// realtime connections and the open rooms per address are raised for the same reason as above. Every other room
// limit stays real.
const requested = JSON.parse(process.env.E2E_ROOMS);
const rooms = {
  ...requested,
  limits: { socketsPerAddress: 10_000, openRoomsPerAddress: 10_000, ...requested.limits },
};
const { close } = await startServer({ config, logger, limits, rooms });
handleShutdownSignals({ close, logger });
