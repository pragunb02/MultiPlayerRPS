import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelemetryAccessor } from "../../data/telemetryAccessor.js";
import { createTelemetryDailyAccessor } from "../../data/telemetryDailyAccessor.js";
import { captureLogger } from "../../testing/captureLogger.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { createInMemoryTelemetryCountDao } from "../../testing/inMemoryTelemetryCountDao.js";
import { createInMemoryTelemetryDailyDao } from "../../testing/inMemoryTelemetryDailyDao.js";
import { addDays, startOfDay } from "../../utils/indiaTime.js";
import { TELEMETRY_KEEP_DAYS } from "../../persistence/telemetryCountDao.js";
import {
  COUNTERS_KEPT_DAYS,
  createRollupJob,
  nextRunAt,
  oldestFullDay,
  ROLLUP_STEPS,
  scheduleRollups,
} from "./rollupJob.js";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
// 09:00 in India on Wednesday 2026-10-21.
const NOW = startOfDay("2026-10-21") + 9 * HOUR;

/** The whole store, with the job on top of it and a clock the test moves. */
function setup({ on = true, now = NOW, owner = "process-a", stores } = {}) {
  const countDao = stores?.countDao ?? createInMemoryTelemetryCountDao();
  const dailyDao = stores?.dailyDao ?? createInMemoryTelemetryDailyDao();
  const counts = createTelemetryAccessor({ telemetryCountDao: countDao });
  const daily = createTelemetryDailyAccessor({ telemetryDailyDao: dailyDao });
  const clock = { now };
  const log = captureLogger();
  const runs = [];
  const job = createRollupJob({
    telemetryAccessor: counts,
    telemetryDailyAccessor: daily,
    isOn: async () => on,
    now: () => clock.now,
    logger: log.logger,
    onRun: (run) => runs.push(run),
    owner,
    pause: async () => {},
  });
  return { job, counts, daily, clock, log, runs, stores: { countDao, dailyDao } };
}

/** Adds `count` presses of the home page's guest button in the given India hour of a day. */
const press = (counts, day, count, hour = 10) =>
  counts.add(
    Array.from({ length: count }, () => ({
      receivedAt: startOfDay(day) + hour * HOUR,
      name: "control_pressed",
      build: "2026.10.18+abc1234",
      tier: "counts",
      route: "/",
      device: "phone",
      player_kind: "guest",
      control: "home.play_guest",
      has_reason: false,
    })),
  );

const totalOn = async (daily, day) =>
  (await daily.read({ from: day, to: day, events: ["control_pressed"] })).find(
    ({ group }) => Object.keys(group).length === 0,
  )?.count;

afterEach(() => vi.useRealTimers());

describe("nextRunAt (CC-176)", () => {
  it("is the next 00:30 in India", () => {
    expect(nextRunAt(NOW)).toBe(startOfDay("2026-10-22") + 30 * MINUTE);
    expect(nextRunAt(startOfDay("2026-10-22") + 10 * MINUTE)).toBe(startOfDay("2026-10-22") + 30 * MINUTE);
    expect(nextRunAt(startOfDay("2026-10-22") + 30 * MINUTE)).toBe(startOfDay("2026-10-23") + 30 * MINUTE);
  });
});

describe("the rollup job (CC-176)", () => {
  // AC-2
  it("running a day twice changes nothing", async () => {
    const { job, counts, daily } = setup();
    await press(counts, "2026-10-20", 6);

    await job.runOnce();
    const once = await daily.read({ from: "2026-10-20", to: "2026-10-20", events: ["control_pressed"] });
    await job.runOnce();
    const twice = await daily.read({ from: "2026-10-20", to: "2026-10-20", events: ["control_pressed"] });

    expect(once.length).toBeGreaterThan(0);
    expect(twice).toEqual(once);
    expect(await totalOn(daily, "2026-10-20")).toBe(6);
  });

  it("redoes the last 2 complete days, so a late beacon is counted, and never today", async () => {
    const { job, counts, daily } = setup();
    await press(counts, "2026-10-19", 5);
    await press(counts, "2026-10-21", 9, 2);
    await job.runOnce();

    // A beacon of the 19th that arrived late, counted into that day's hour by ingestion.
    await press(counts, "2026-10-19", 2, 23);
    const { rolled } = await job.runOnce();

    expect(rolled).toEqual(["2026-10-19", "2026-10-20"]);
    expect(await totalOn(daily, "2026-10-19")).toBe(7);
    expect(await totalOn(daily, "2026-10-21")).toBeUndefined();
  });

  // AC-3
  it("catches up missed days once", async () => {
    const shared = setup();
    await press(shared.counts, "2026-10-12", 5);
    await press(shared.counts, "2026-10-17", 8);
    // The instance slept for a week: no day of the last 30 has a run record yet.

    const first = await shared.job.runOnce();

    // Only days whose counters are all still kept (review of #176): 30 days back, the TTL has taken its first hours.
    expect(first.rolled).toHaveLength(29);
    expect(first.rolled[0]).toBe(addDays("2026-10-21", -29));
    expect(first.rolled.at(-1)).toBe("2026-10-20");
    expect(await totalOn(shared.daily, "2026-10-12")).toBe(5);
    expect(await totalOn(shared.daily, "2026-10-17")).toBe(8);

    // The hourly tick after: only the last 2 days again.
    shared.clock.now += HOUR;
    expect((await shared.job.runOnce()).rolled).toEqual(["2026-10-19", "2026-10-20"]);

    // A day partly deleted by the TTL (30 days back) is never rolled up: its total would be short.
    expect(await totalOn(shared.daily, addDays("2026-10-21", -30))).toBeUndefined();
  });

  it("lets only one process roll up a day: a second one skips the days whose lease is held", async () => {
    const a = setup({ owner: "process-a" });
    const b = setup({ owner: "process-b", stores: a.stores });
    await press(a.counts, "2026-10-20", 5);
    // Process a holds the 20th's lease (it is rolling it up right now).
    await a.daily.acquireRun({
      day: "2026-10-20",
      dayStart: startOfDay("2026-10-20"),
      owner: "process-a",
      now: NOW,
      leaseMs: 10 * MINUTE,
    });

    const { rolled, busy } = await b.job.runOnce();

    expect(rolled).not.toContain("2026-10-20");
    expect(busy).toEqual(["2026-10-20"]);
    expect(await totalOn(b.daily, "2026-10-20")).toBeUndefined();
  });

  it("backfills from a day to yesterday whatever the run records say, never past the counters' 30 days", async () => {
    const { job, counts, daily } = setup();
    await press(counts, "2026-10-15", 5);
    await job.runOnce();
    await press(counts, "2026-10-15", 3, 22);

    const { rolled } = await job.backfill({ from: "2026-01-01" });

    expect(rolled[0]).toBe(addDays("2026-10-21", -29));
    expect(rolled.at(-1)).toBe("2026-10-20");
    expect(await totalOn(daily, "2026-10-15")).toBe(8);
  });

  it("rolls up only days whose counters are all still kept, at any time of day", () => {
    expect(COUNTERS_KEPT_DAYS).toBe(TELEMETRY_KEEP_DAYS);
    expect(oldestFullDay(NOW)).toBe(addDays("2026-10-21", -29));
    expect(oldestFullDay(startOfDay("2026-10-21"))).toBe(addDays("2026-10-21", -29));
    expect(oldestFullDay(startOfDay("2026-10-22") - 1)).toBe(addDays("2026-10-21", -29));
  });

  it("stops between days when told to, so a shutdown waits for one day at most", async () => {
    const { job, counts } = setup();
    await press(counts, "2026-10-20", 5);
    let asked = 0;

    const { rolled } = await job.runOnce({ isStopped: () => (asked += 1) > 1 });
    const back = await job.backfill({ from: "2026-10-01", isStopped: () => true });

    expect(rolled).toHaveLength(1);
    expect(back.rolled).toEqual([]);
  });

  it("tells a run in progress to stop when the scheduler stops", async () => {
    const seen = [];
    let release;
    const scheduled = scheduleRollups({
      run: async ({ isStopped }) => {
        await new Promise((resolve) => {
          release = resolve;
        });
        seen.push(isStopped());
      },
      now: () => NOW,
      logger: captureLogger().logger,
    });

    scheduled.start();
    await vi.waitFor(() => expect(release).toBeDefined());
    const stopping = scheduled.stop();
    release();
    await stopping;

    expect(seen).toEqual([true]);
  });

  // AC-7
  flagPaths("telemetry_rollup", (on) => {
    it(on ? "rolls days up while the flag is on" : "runs nothing while the flag is off", async () => {
      const { job, counts, daily, runs } = setup({ on });
      await press(counts, "2026-10-20", 5);

      const result = await job.runOnce();

      expect(result.skipped).toBe(on ? undefined : "flag_off");
      expect(await totalOn(daily, "2026-10-20")).toBe(on ? 5 : undefined);
      expect(runs.some(({ outcome }) => outcome === "ok")).toBe(on);
    });
  });

  it("counts a run that could not read the run records as failed, and the scheduler logs a run that throws", async () => {
    const base = createInMemoryTelemetryDailyDao();
    const dailyDao = {
      ...base,
      doneDays: async () => {
        throw new Error("database down");
      },
    };
    const { job, log, runs } = setup({ stores: { countDao: createInMemoryTelemetryCountDao(), dailyDao } });

    const result = await job.runOnce();

    expect(result).toEqual({ rolled: [], busy: [], failed: [] });
    expect(log.find("telemetry rollup failed")[0]).toEqual(expect.objectContaining({ step: "lock" }));
    expect(runs).toEqual([{ outcome: "failed" }]);

    const logged = captureLogger();
    const scheduled = scheduleRollups({
      run: async () => {
        throw new Error("boom");
      },
      now: () => NOW,
      logger: logged.logger,
    });
    scheduled.start();
    await logged.once("telemetry rollup failed");
    await scheduled.stop();
  });

  it("logs a lease that could not be taken as the lock step, and gives back nothing it did not take", async () => {
    const base = createInMemoryTelemetryDailyDao();
    let released = 0;
    const dailyDao = {
      ...base,
      acquireRun: async () => {
        throw new Error("database down");
      },
      releaseRun: async (...args) => {
        released += 1;
        return base.releaseRun(...args);
      },
    };
    const { job, log } = setup({ stores: { countDao: createInMemoryTelemetryCountDao(), dailyDao } });

    const { failed } = await job.runOnce();

    expect(failed).toHaveLength(29);
    expect(log.find("telemetry rollup failed")[0]).toEqual(expect.objectContaining({ step: "lock" }));
    expect(released).toBe(0);
  });

  // AC-8
  it("a failed run is counted and retried", async () => {
    const base = createInMemoryTelemetryDailyDao();
    let down = true;
    const dailyDao = {
      ...base,
      replaceDay: async (input) => {
        if (down && input.day === "2026-10-20") throw new Error("database down");
        return base.replaceDay(input);
      },
    };
    const { job, counts, daily, log, runs } = setup({
      stores: { countDao: createInMemoryTelemetryCountDao(), dailyDao },
    });
    await press(counts, "2026-10-20", 5);

    await job.runOnce();

    const [line] = log.find("telemetry rollup failed");
    expect(line).toEqual(expect.objectContaining({ step: "write", level: 50 }));
    expect(ROLLUP_STEPS).toContain(line.step);
    expect(runs).toContainEqual({ outcome: "failed" });
    expect(await daily.doneDays({ from: "2026-10-20", to: "2026-10-20" })).toEqual([]);

    down = false;
    await job.runOnce();

    expect(await totalOn(daily, "2026-10-20")).toBe(5);
    expect(await daily.doneDays({ from: "2026-10-20", to: "2026-10-20" })).toEqual(["2026-10-20"]);
  });

  it("runs on start, every hour and at 00:30 India time, on the injected clock, one run at a time", async () => {
    vi.useFakeTimers({ now: NOW });
    const { job, counts, daily } = setup({ now: NOW });
    const ticks = [];
    const realRun = job.runOnce;
    const scheduled = scheduleRollups({
      run: async () => {
        ticks.push(Date.now());
        return realRun();
      },
      now: Date.now,
      logger: captureLogger().logger,
    });
    await press(counts, "2026-10-20", 5);

    scheduled.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks).toEqual([NOW]);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(ticks).toHaveLength(2);
    // From 09:00 to 00:30 the next day: 15.5 hours, 15 hourly ticks so far and the 00:30 run.
    await vi.advanceTimersByTimeAsync(14.5 * HOUR);
    expect(ticks).toContain(startOfDay("2026-10-22") + 30 * MINUTE);
    await scheduled.stop();
    const count = ticks.length;
    await vi.advanceTimersByTimeAsync(3 * HOUR);

    expect(ticks).toHaveLength(count);
    expect(await totalOn(daily, "2026-10-20")).toBe(5);
  });
});
