// The ramp of the load test (CC-289): how many players each step adds, and when a step counts as broken.
import { summarize } from "./stats.mjs";

/** Players at once in each step, unless the run names its own. */
export const DEFAULT_STEPS = Object.freeze([
  10, 20, 40, 60, 80, 100, 130, 160, 200, 250, 300, 400, 500, 650, 800, 1000, 1300, 1600, 2000, 2500, 3000,
]);

/**
 * Render instance sizes the harness can model with `docker run --cpus --memory` (research section 2.5, prices from
 * https://render.com/pricing on 2026-10-20).
 */
export const RENDER_SIZES = Object.freeze({
  free: Object.freeze({ cpus: "0.1", memory: "512m", dollarsPerMonth: 0 }),
  starter: Object.freeze({ cpus: "0.5", memory: "512m", dollarsPerMonth: 7 }),
  standard: Object.freeze({ cpus: "1", memory: "2g", dollarsPerMonth: 25 }),
});

/** NFR-3: the 95th percentile of the move round trip stays under 150 ms. */
export const MOVE_P95_LIMIT_MS = 150;

/**
 * Reads a list of players at once such as "10,20,40". Answers the default steps for an empty value.
 *
 * @param {string | undefined} raw
 * @returns {ReadonlyArray<number>}
 */
export function parseSteps(raw) {
  if (raw === undefined || raw.trim() === "") return DEFAULT_STEPS;
  const steps = raw.split(",").map((part) => Number(part.trim()));
  if (steps.some((step, index) => !Number.isInteger(step) || step < 1 || step <= (steps[index - 1] ?? 0))) {
    throw new RangeError(`Steps must be whole numbers that grow, such as 10,20,40 (got "${raw}")`);
  }
  return Object.freeze(steps);
}

/**
 * Whether a step broke the server: the move p95 over the limit, or any failure at all.
 *
 * @param {{ moves: { count: number, p95: number }, failures: Record<string, number> }} step
 * @param {{ moveP95LimitMs?: number }} [limits]
 * @returns {{ broken: boolean, reasons: string[] }}
 */
export function verdict({ moves, failures }, { moveP95LimitMs = MOVE_P95_LIMIT_MS } = {}) {
  const reasons = [];
  if (moves.p95 > moveP95LimitMs) {
    reasons.push(`move p95 ${moves.p95} ms is over ${moveP95LimitMs} ms`);
  }
  const failed = Object.values(failures).reduce((sum, count) => sum + count, 0);
  if (failed > 0) {
    reasons.push(`${failed} failures: ${Object.keys(failures).join(", ")}`);
  }
  return { broken: reasons.length > 0, reasons };
}

/**
 * Sums up the server's readings of a step: the worst event-loop p99, mean and peak CPU, peak memory.
 *
 * @param {ReadonlyArray<{ loopP99Ms: number, loopMaxMs: number, cpu: number, rssMb: number, heapUsedMb: number }>} readings
 * @returns {{ loopP99Ms: { p50: number, max: number }, loopMaxMs: number, cpu: { mean: number, max: number }, rssMb: number, heapUsedMb: number }}
 */
export function serverSummary(readings) {
  const loop = summarize(readings.map((reading) => reading.loopP99Ms));
  const cpu = readings.map((reading) => reading.cpu);
  const peak = (values) => Math.max(0, ...values);
  const mean = cpu.length === 0 ? 0 : cpu.reduce((sum, value) => sum + value, 0) / cpu.length;
  return {
    loopP99Ms: { p50: loop.p50, max: loop.max },
    loopMaxMs: peak(readings.map((reading) => reading.loopMaxMs)),
    cpu: { mean: Math.round(mean * 1000) / 1000, max: peak(cpu) },
    rssMb: peak(readings.map((reading) => reading.rssMb)),
    heapUsedMb: peak(readings.map((reading) => reading.heapUsedMb)),
  };
}

/**
 * MongoDB operations a second between two `serverStatus().opcounters` readings, by kind and in total. The harness's
 * own `serverStatus` command is one a reading and is taken off.
 *
 * @param {Record<string, number>} before
 * @param {Record<string, number>} after
 * @param {number} seconds
 * @returns {Record<string, number>}
 */
export function opsPerSecond(before, after, seconds) {
  const kinds = ["insert", "query", "update", "delete", "getmore", "command"];
  const rates = Object.fromEntries(
    kinds.map((kind) => {
      const delta = Number(after[kind] ?? 0) - Number(before[kind] ?? 0) - (kind === "command" ? 1 : 0);
      return [kind, Math.round((Math.max(delta, 0) / seconds) * 10) / 10];
    }),
  );
  return { ...rates, total: Math.round(kinds.reduce((sum, kind) => sum + rates[kind], 0) * 10) / 10 };
}
