// The server for the load test (CC-289), run inside the production image by `npm run load:test`. It is
// `apps/server/src/index.js` with two differences, both for the test only:
//
// 1. Every simulated player connects from the harness's one address, so the limits per address (guest sign-ins,
//    `/api` requests, sockets and rooms per address) are raised in code here, as `load-moves.mjs` and the browser
//    tests do. The 2000 room cap, the event budget per player and every other rule stay as in production. There
//    is no env var for this, so production cannot switch it on.
// 2. A probe prints the event-loop delay, CPU and memory once a second (scripts/load/probe.mjs).
import { monitorEventLoopDelay } from "node:perf_hooks";

import { loadConfig } from "../../apps/server/src/config/index.js";
import { handleFatalErrors, handleShutdownSignals, startServer } from "../../apps/server/src/server.js";
import { createLogger } from "../../apps/server/src/utils/logger.js";
import { createProbe, PROBE_PREFIX } from "../load/probe.mjs";

const config = loadConfig(process.env);
const logger = createLogger({ level: config.logLevel });
handleFatalErrors({ logger });

const open = { windowMs: 60_000, limit: 1_000_000 };
const limits = { auth: { perIp: open, signupPerIp: open }, guest: open, leaderboard: open, api: open };
const rooms = { limits: { socketsPerAddress: 1_000_000, openRoomsPerAddress: 1_000_000 } };

// A 10 ms resolution keeps the probe's own cost far below what it measures.
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
const probe = createProbe({
  loopDelay,
  cpuUsage: (previous) => process.cpuUsage(previous),
  memoryUsage: () => process.memoryUsage(),
  now: Date.now,
});
setInterval(() => process.stdout.write(`${PROBE_PREFIX}${JSON.stringify(probe.read())}\n`), 1_000).unref();

const { port, close } = await startServer({ config, logger, limits, rooms });
logger.warn({ port, env: config.env }, "load test server listening, with the limits per address raised");
handleShutdownSignals({ close, logger });
