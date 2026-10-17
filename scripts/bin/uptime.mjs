// Entry point for the uptime workflow. It only wires the real network, clock and timers into
// scripts/uptime/monitor.mjs, where the behaviour lives and is tested.
import { setTimeout as sleep } from "node:timers/promises";

import { runUptimeMonitor } from "../uptime/monitor.mjs";

process.exitCode = await runUptimeMonitor({
  env: process.env,
  fetch: globalThis.fetch,
  now: () => Date.now(),
  sleep: (ms) => sleep(ms),
  stdout: process.stdout,
  stderr: process.stderr,
});
