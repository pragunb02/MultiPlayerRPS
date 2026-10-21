#!/usr/bin/env node
// The owner's backfill of the daily usage totals (CC-176), after a fix in the rollup:
//
//   MONGO_URI=… node scripts/bin/rollup-telemetry.mjs --from 2026-10-01
//
// Rolls up every complete India day from that day to yesterday again, whatever the run records and the
// telemetry_rollup flag say. Only days whose hourly counters are all still kept (the last 29 complete ones) are rolled up.
// It prints the days it rolled up, and the days another process held or that failed. Nothing about any player.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createTelemetryAccessor } from "../../apps/server/src/data/telemetryAccessor.js";
import { createTelemetryDailyAccessor } from "../../apps/server/src/data/telemetryDailyAccessor.js";
import { createRollupJob } from "../../apps/server/src/domain/telemetry/rollupJob.js";
import { connectDatabase } from "../../apps/server/src/persistence/database.js";
import { createTelemetryCountDao } from "../../apps/server/src/persistence/telemetryCountDao.js";
import { createTelemetryDailyDao } from "../../apps/server/src/persistence/telemetryDailyDao.js";
import { isDay } from "../../apps/server/src/utils/indiaTime.js";
import { createLogger } from "../../apps/server/src/utils/logger.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const { values } = parseArgs({ options: { from: { type: "string" } } });
if (!isDay(values.from)) {
  process.stderr.write("Usage: node scripts/bin/rollup-telemetry.mjs --from YYYY-MM-DD\n");
  process.exit(2);
}
if (!process.env.MONGO_URI) {
  process.stderr.write("Set MONGO_URI to the database to backfill.\n");
  process.exit(2);
}

const logger = createLogger({ level: "info" });
const database = await connectDatabase({ uri: process.env.MONGO_URI, logger });
try {
  const telemetryDailyDao = createTelemetryDailyDao({ connection: database.connection });
  await telemetryDailyDao.ensureIndexes();
  const job = createRollupJob({
    telemetryAccessor: createTelemetryAccessor({
      telemetryCountDao: createTelemetryCountDao({ connection: database.connection }),
    }),
    telemetryDailyAccessor: createTelemetryDailyAccessor({ telemetryDailyDao }),
    isOn: async () => true,
    now: Date.now,
    logger,
  });
  const { rolled, busy, failed } = await job.backfill({ from: values.from });
  process.stdout.write(`${JSON.stringify({ rolled, busy, failed }, null, 2)}\n`);
  process.exitCode = failed.length > 0 ? 1 : 0;
} finally {
  await database.close();
}
