import { randomUUID } from "node:crypto";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { TELEMETRY_ROLLUP_OUTCOMES, TELEMETRY_ROLLUP_STEPS } from "../../utils/operationsMetrics.js";
import { addDays, dayOf, startOfDay } from "../../utils/indiaTime.js";
import { yieldToEventLoop } from "../../utils/yieldToEventLoop.js";
import { rollUpDay } from "./rollups.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** How long the hourly counters are kept (CC-175, `TELEMETRY_KEEP_DAYS` in persistence): 30 days after each hour. */
export const COUNTERS_KEPT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The oldest India day whose counters are all still kept: its first hour is less than 30 days old. The day 30 back has
 * already lost its first hours to the TTL, so its total would be short and is never written (review of #176).
 *
 * @param {number} now  ms
 * @returns {string}
 */
export function oldestFullDay(now) {
  // The day `kept` falls in started at or before it, so its first hours are gone: the next day is the oldest whole one.
  return addDays(dayOf(now - COUNTERS_KEPT_DAYS * DAY_MS), 1);
}
/** The complete days rolled up again on every run, so a late beacon is counted (owner default, 2026-10-22). */
export const ROLLUP_REDO_DAYS = 2;
/** How long a process holds a day before another may take it, if the first one died mid-run. */
export const ROLLUP_LEASE_MS = 10 * MINUTE_MS;
/** The time of the nightly run after India midnight: 00:30, the quietest half hour. */
export const ROLLUP_AT_MS = 30 * MINUTE_MS;
/** At most this many counters in one India hour: the day's cap of stored events (CC-175) bounds it. */
const HOUR_LIMIT = 100_000;

/** The steps a run can fail at and how a day's run ended, as operations telemetry names them (ADR-055). */
export const ROLLUP_STEPS = TELEMETRY_ROLLUP_STEPS;
export const ROLLUP_OUTCOMES = TELEMETRY_ROLLUP_OUTCOMES;

/**
 * The next 00:30 in India after a moment.
 *
 * @param {number} now  ms
 * @returns {number} ms
 */
export function nextRunAt(now) {
  const today = startOfDay(dayOf(now)) + ROLLUP_AT_MS;
  return today > now ? today : startOfDay(addDays(dayOf(now), 1)) + ROLLUP_AT_MS;
}

class StepError extends Error {
  constructor(step, cause) {
    super(`rollup ${step} failed`, { cause });
    this.step = step;
  }
}

const stepped = async (step, work) => {
  try {
    return await work();
  } catch (cause) {
    throw new StepError(step, cause);
  }
};

/**
 * The nightly telemetry rollup (CC-176): turns each complete India day's hourly counters (CC-175) into daily totals
 * kept 13 months. Each run rolls up every complete day of the last 30 that has no run record, and the last 2 complete
 * days always. A day is leased before it is read, so a second process skips it, and replaced as a whole, so running it
 * twice gives the same rows. A failed day keeps no run record, so the next tick tries again.
 *
 * @param {{
 *   telemetryAccessor: Pick<ReturnType<typeof import("../../data/telemetryAccessor.js").createTelemetryAccessor>, "list">,
 *   telemetryDailyAccessor: ReturnType<typeof import("../../data/telemetryDailyAccessor.js").createTelemetryDailyAccessor>,
 *   isOn: () => Promise<boolean>,  the `telemetry_rollup` flag (CC-312)
 *   now: () => number,
 *   logger: import("pino").Logger,
 *   onRun?: (run: { outcome: string }) => void,  the ops counter `telemetry_rollup.runs` (ADR-055)
 *   owner?: string,  this process, for the leases
 *   pause?: () => Promise<void>,  between the hours of a day, so live games are never held up
 * }} deps
 */
export function createRollupJob({
  telemetryAccessor,
  telemetryDailyAccessor,
  isOn,
  now,
  logger,
  onRun = () => undefined,
  owner = randomUUID(),
  pause = yieldToEventLoop,
}) {
  assertDefined(telemetryAccessor, "telemetryAccessor");
  assertDefined(telemetryDailyAccessor, "telemetryDailyAccessor");
  assertFunction(isOn, "isOn");
  assertFunction(now, "now");
  assertDefined(logger, "logger");

  /** The days this run rolls up, oldest first. */
  async function daysToRoll(at) {
    const today = dayOf(at);
    const window = { from: oldestFullDay(at), to: addDays(today, -1) };
    const done = new Set(await telemetryDailyAccessor.doneDays(window));
    const days = [];
    for (let day = window.from; day <= window.to; day = addDays(day, 1)) days.push(day);
    return days.filter((day) => !done.has(day) || day >= addDays(today, -ROLLUP_REDO_DAYS));
  }

  /** Rolls up days one after the other, stopping between two days when told to (a shutdown). */
  async function rollDays(days, isStopped) {
    const result = { rolled: [], busy: [], failed: [] };
    for (const day of days) {
      if (isStopped()) break;
      const outcome = await rollDay(day);
      result[outcome === "ok" ? "rolled" : outcome].push(day);
    }
    return result;
  }

  /** A day's counters, an India hour at a time with a pause between hours. */
  async function countersOf(day) {
    const start = startOfDay(day);
    const counters = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const from = start + hour * HOUR_MS;
      // One at a time: spreading an hour of up to 100 000 counters into push would overflow the call stack.
      for (const row of await telemetryAccessor.list({ from, to: from + HOUR_MS, limit: HOUR_LIMIT }))
        counters.push(row);
      await pause();
    }
    return counters;
  }

  /** @returns {Promise<"ok" | "busy" | "failed">} */
  async function rollDay(day) {
    const dayStart = startOfDay(day);
    let leased = false;
    try {
      leased = await stepped("lock", () =>
        telemetryDailyAccessor.acquireRun({ day, dayStart, owner, now: now(), leaseMs: ROLLUP_LEASE_MS }),
      );
      if (!leased) return "busy";
      const counters = await stepped("read", () => countersOf(day));
      const rows = await stepped("total", () => rollUpDay({ day, counters, pause }));
      await stepped("write", () => telemetryDailyAccessor.replaceDay({ day, dayStart, rows }));
      await stepped("finish", () => telemetryDailyAccessor.finishRun({ day, owner, now: now() }));
      onRun({ outcome: ROLLUP_OUTCOMES.OK });
      return "ok";
    } catch (err) {
      // Every step is wrapped, so the error names its step. The day and the step, nothing about any event.
      logger.error({ err: err.cause, step: err.step }, "telemetry rollup failed");
      onRun({ outcome: ROLLUP_OUTCOMES.FAILED });
      if (leased) {
        await telemetryDailyAccessor.releaseRun({ day, owner, now: now() }).catch(() => undefined);
      }
      return "failed";
    }
  }

  return Object.freeze({
    /**
     * The owner's backfill after a fix (`scripts/bin/rollup-telemetry.mjs`): every complete day from `from`
     * to yesterday, whatever their run records say and whatever the flag. Only days whose counters are all still
     * kept: older days are left as they are, because their totals could no longer be whole.
     *
     * @param {{ from: string, isStopped?: () => boolean }} input
     * @returns {Promise<{ rolled: string[], busy: string[], failed: string[] }>}
     */
    async backfill({ from, isStopped = () => false }) {
      const at = now();
      const today = dayOf(at);
      const oldest = oldestFullDay(at);
      const days = [];
      for (let day = from > oldest ? from : oldest; day < today; day = addDays(day, 1)) days.push(day);
      return rollDays(days, isStopped);
    },

    /**
     * One run. Never throws: a failed day is logged and counted. `isStopped` is asked before each day, so a shutdown
     * waits for one day at most.
     *
     * @param {{ isStopped?: () => boolean }} [options]
     * @returns {Promise<{ rolled: string[], busy: string[], failed: string[], skipped?: string }>}
     */
    async runOnce({ isStopped = () => false } = {}) {
      const result = { rolled: [], busy: [], failed: [] };
      if (!(await isOn())) return { ...result, skipped: "flag_off" };
      let days;
      try {
        days = await daysToRoll(now());
      } catch (err) {
        logger.error({ err, step: "lock" }, "telemetry rollup failed");
        onRun({ outcome: ROLLUP_OUTCOMES.FAILED });
        return result;
      }
      return rollDays(days, isStopped);
    },
  });
}

/**
 * Runs the rollup on start, every hour and at 00:30 India time (CC-176, owner default 2026-10-22). One run at a time:
 * a tick that comes while a run is still going is skipped. Timers do not keep the process alive. `run` is given
 * `isStopped`, which turns true once `stop` is called, so a catch-up of many days ends after the day in hand.
 *
 * @param {{ run: (options: { isStopped: () => boolean }) => Promise<unknown>, now: () => number, logger: import("pino").Logger }} deps
 * @returns {{ start: () => void, stop: () => Promise<void> }}
 */
export function scheduleRollups({ run, now, logger }) {
  let running;
  let nightly;
  let hourly;
  let stopped = false;
  const tick = () => {
    if (stopped || running !== undefined) return;
    running = Promise.resolve()
      .then(() => run({ isStopped: () => stopped }))
      .catch((err) => logger.error({ err, step: "lock" }, "telemetry rollup failed"))
      .finally(() => {
        running = undefined;
      });
  };
  const armNightly = () => {
    nightly = setTimeout(
      () => {
        tick();
        armNightly();
      },
      Math.max(1_000, nextRunAt(now()) - now()),
    );
    nightly.unref?.();
  };
  return {
    start() {
      tick();
      hourly = setInterval(tick, HOUR_MS);
      hourly.unref?.();
      armNightly();
    },
    async stop() {
      stopped = true;
      clearTimeout(nightly);
      clearInterval(hourly);
      await running;
    },
  };
}
