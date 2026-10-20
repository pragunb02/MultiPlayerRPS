// One app process for the browser tests: the real server in production configuration with the built web app.
// server.mjs starts it, and starts it again whenever it stops (serverControl.js).
import { loadConfig } from "../apps/server/src/config/index.js";
import { handleShutdownSignals, startServer } from "../apps/server/src/server.js";
import { createLogger } from "../apps/server/src/utils/logger.js";
import { appEnv } from "./appEnv.js";

const config = loadConfig(appEnv({ mongoUri: process.env.E2E_MONGO_URI }));
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
  // Blocking keeps its real limit per player (CC-044). Only the one per address is raised.
  blocks: { perAddress: { windowMs: 60_000, limit: 10_000 } },
  // Profile lookups keep their real limit per player (CC-034). Only the one per address is raised.
  profiles: { lookupsPerAddress: { windowMs: 60_000, limit: 10_000 } },
  // Feedback keeps its real limit per session (CC-290). The ones per address and for the site are raised.
  feedback: {
    perAddress: { windowMs: 60_000, limit: 10_000 },
    perAddressDaily: { windowMs: 60_000, limit: 10_000 },
    site: { windowMs: 60_000, limit: 10_000 },
  },
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
// No telemetry here, so there is nothing to flush before exit (CC-305).
handleShutdownSignals({ close, flush: async () => undefined, logger });
