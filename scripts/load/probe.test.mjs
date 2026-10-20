import { describe, expect, it } from "vitest";

import { createProbe, parseProbeLines, PROBE_PREFIX } from "./probe.mjs";

function fakes() {
  let time = 1_000;
  let cpu = { user: 0, system: 0 };
  const loopDelay = {
    p: { 50: 2_000_000, 99: 15_550_000 },
    max: 40_000_000,
    mean: 3_000_000,
    resets: 0,
    percentile(value) {
      return this.p[value];
    },
    reset() {
      this.resets += 1;
    },
  };
  return {
    loopDelay,
    cpuUsage: (previous) =>
      previous === undefined ? cpu : { user: cpu.user - previous.user, system: cpu.system - previous.system },
    memoryUsage: () => ({ rss: 150_000_000, heapUsed: 60_040_000 }),
    now: () => time,
    pass(ms, used) {
      time += ms;
      cpu = { user: cpu.user + used, system: cpu.system };
    },
  };
}

describe("createProbe", () => {
  it("reads the loop delay, the CPU used a second since the last reading and the memory", () => {
    const deps = fakes();
    const probe = createProbe(deps);
    deps.pass(2_000, 100_000);

    expect(probe.read()).toEqual({
      at: 3_000,
      loopP50Ms: 2,
      loopP99Ms: 15.6,
      loopMaxMs: 40,
      cpu: 0.05,
      rssMb: 150,
      heapUsedMb: 60,
    });
    expect(deps.loopDelay.resets).toBe(1);
  });

  it("starts each reading where the last one ended", () => {
    const deps = fakes();
    const probe = createProbe(deps);
    deps.pass(1_000, 500_000);
    probe.read();
    deps.pass(1_000, 100_000);

    expect(probe.read().cpu).toBe(0.1);
  });
});

describe("parseProbeLines", () => {
  it("finds the probe's readings among the server's own lines", () => {
    const text = `{"level":40,"msg":"socket refused"}\n${PROBE_PREFIX}{"at":1,"cpu":0.1}\n\n`;

    expect(parseProbeLines(text)).toEqual([{ at: 1, cpu: 0.1 }]);
  });
});
