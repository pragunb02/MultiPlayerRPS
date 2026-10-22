import { createTelemetryAccessor } from "../data/telemetryAccessor.js";
import { createTelemetryDailyAccessor } from "../data/telemetryDailyAccessor.js";
import { createRollupJob } from "../domain/telemetry/rollupJob.js";
import { createTelemetryReport } from "../domain/telemetry/telemetryReport.js";
import { createUxReport, UX_REPORT_TTL_MS } from "../domain/telemetry/uxReport.js";
import { addDays, dayOf } from "../utils/indiaTime.js";
import { createTtlCache } from "../utils/ttlCache.js";
import { captureLogger } from "./captureLogger.js";
import { createInMemoryTelemetryCountDao } from "./inMemoryTelemetryCountDao.js";
import { createInMemoryTelemetryDailyDao } from "./inMemoryTelemetryDailyDao.js";
import { uxSeedEvents } from "./uxSeed.js";

/**
 * The UX report over made-up counts (CC-177): the last 14 complete India days before `now` get the seed, the 7
 * before the last 7 at `beforeScale`, rolled up by the real job into daily totals.
 *
 * @param {{ now: number, beforeScale?: number, seed?: boolean, extra?: (day: string) => object[] }} options  `extra`:
 *   more events for each of the 14 days, with or without the seed
 */
export async function uxReportOver({ now, beforeScale = 0.8, seed = true, extra = () => [] }) {
  const telemetryAccessor = createTelemetryAccessor({ telemetryCountDao: createInMemoryTelemetryCountDao() });
  const dailyDao = createInMemoryTelemetryDailyDao();
  const telemetryDailyAccessor = createTelemetryDailyAccessor({ telemetryDailyDao: dailyDao });
  const today = dayOf(now);
  for (let back = 1; back <= 14; back += 1) await telemetryAccessor.add(extra(addDays(today, -back)));
  if (seed) {
    for (let back = 1; back <= 14; back += 1) {
      await telemetryAccessor.add(
        uxSeedEvents({ day: addDays(today, -back), scale: back > 7 ? beforeScale : 1 }),
      );
    }
  }
  await createRollupJob({
    telemetryAccessor,
    telemetryDailyAccessor,
    isOn: async () => true,
    now: () => now,
    logger: captureLogger().logger,
    pause: async () => {},
  }).runOnce();
  const reads = [];
  const telemetryReport = createTelemetryReport({
    telemetryDailyAccessor: {
      read: (range) => {
        reads.push(range);
        return telemetryDailyAccessor.read(range);
      },
    },
  });
  const clock = { now };
  const uxReport = createUxReport({
    telemetryReport,
    cache: createTtlCache({ ttlMs: UX_REPORT_TTL_MS, maxEntries: 50 }),
    now: () => clock.now,
  });
  return { uxReport, reads, clock };
}
