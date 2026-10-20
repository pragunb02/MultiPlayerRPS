// Readings taken inside the server's process during a load test (CC-289): how late its event loop runs, how much
// CPU it used and how much memory it holds. The harness starts the probe beside the server, never in production.

/** Lines the probe prints start with this, so the harness can find them among the server's own log lines. */
export const PROBE_PREFIX = "load-probe ";

/**
 * Makes one reading every time `read` is called, covering the time since the reading before.
 *
 * @param {{
 *   loopDelay: { percentile: (p: number) => number, max: number, mean: number, reset: () => void },
 *   cpuUsage: (previous?: NodeJS.CpuUsage) => NodeJS.CpuUsage,
 *   memoryUsage: () => NodeJS.MemoryUsage,
 *   now: () => number,
 * }} deps  `loopDelay` is a started `perf_hooks.monitorEventLoopDelay` histogram, which counts nanoseconds
 * @returns {{ read: () => { at: number, loopP50Ms: number, loopP99Ms: number, loopMaxMs: number, cpu: number, rssMb: number, heapUsedMb: number } }}
 *   `cpu` is CPU seconds used per second, so 0.1 is all of a 0.1 CPU quota
 */
export function createProbe({ loopDelay, cpuUsage, memoryUsage, now }) {
  let cpuBefore = cpuUsage();
  let before = now();
  const ms = (nanoseconds) => Math.round(nanoseconds / 1e5) / 10;
  const mb = (bytes) => Math.round(bytes / 1e5) / 10;
  return {
    read() {
      const at = now();
      const used = cpuUsage(cpuBefore);
      const seconds = Math.max(at - before, 1) / 1000;
      const { rss, heapUsed } = memoryUsage();
      const reading = {
        at,
        loopP50Ms: ms(loopDelay.percentile(50)),
        loopP99Ms: ms(loopDelay.percentile(99)),
        loopMaxMs: ms(loopDelay.max),
        cpu: Math.round(((used.user + used.system) / 1e6 / seconds) * 1000) / 1000,
        rssMb: mb(rss),
        heapUsedMb: mb(heapUsed),
      };
      loopDelay.reset();
      cpuBefore = cpuUsage();
      before = at;
      return reading;
    },
  };
}

/**
 * Finds the probe's readings among lines of output, skipping everything else.
 *
 * @param {string} text   one or more whole lines
 * @returns {Array<ReturnType<ReturnType<typeof createProbe>["read"]>>}
 */
export function parseProbeLines(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith(PROBE_PREFIX))
    .map((line) => JSON.parse(line.slice(PROBE_PREFIX.length)));
}
