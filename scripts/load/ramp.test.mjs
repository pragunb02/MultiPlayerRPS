import { describe, expect, it } from "vitest";

import { DEFAULT_STEPS, opsPerSecond, parseSteps, RENDER_SIZES, serverSummary, verdict } from "./ramp.mjs";

describe("parseSteps", () => {
  it("answers the default steps when none are given", () => {
    expect(parseSteps(undefined)).toBe(DEFAULT_STEPS);
    expect(parseSteps(" ")).toBe(DEFAULT_STEPS);
  });

  it("reads growing whole numbers", () => {
    expect(parseSteps("10, 20,40")).toEqual([10, 20, 40]);
  });

  it.each(["10,10", "20,10", "0,10", "ten", "1.5"])("refuses %s", (raw) => {
    expect(() => parseSteps(raw)).toThrow(RangeError);
  });
});

describe("verdict", () => {
  const moves = { count: 100, p95: 40 };

  it("holds a step with fast moves and no failures", () => {
    expect(verdict({ moves, failures: {} })).toEqual({ broken: false, reasons: [] });
  });

  it("breaks a step whose move p95 is over 150 ms", () => {
    expect(verdict({ moves: { count: 100, p95: 151 }, failures: {} })).toEqual({
      broken: true,
      reasons: ["move p95 151 ms is over 150 ms"],
    });
  });

  it("breaks a step with any failure, and names them", () => {
    const failures = { "room:create SERVER_BUSY": 2, "game:move timed out": 1 };

    expect(verdict({ moves, failures }, { moveP95LimitMs: 30 })).toEqual({
      broken: true,
      reasons: ["move p95 40 ms is over 30 ms", "3 failures: room:create SERVER_BUSY, game:move timed out"],
    });
  });
});

describe("serverSummary", () => {
  it("answers zeros for no readings", () => {
    expect(serverSummary([])).toEqual({
      loopP99Ms: { p50: 0, max: 0 },
      loopMaxMs: 0,
      cpu: { mean: 0, max: 0 },
      rssMb: 0,
      heapUsedMb: 0,
    });
  });

  it("keeps the worst loop delay and memory, and the mean and peak CPU", () => {
    const readings = [
      { loopP99Ms: 12, loopMaxMs: 20, cpu: 0.05, rssMb: 120, heapUsedMb: 40 },
      { loopP99Ms: 80, loopMaxMs: 300, cpu: 0.1, rssMb: 150, heapUsedMb: 60 },
    ];

    expect(serverSummary(readings)).toEqual({
      loopP99Ms: { p50: 12, max: 80 },
      loopMaxMs: 300,
      cpu: { mean: 0.075, max: 0.1 },
      rssMb: 150,
      heapUsedMb: 60,
    });
  });
});

describe("opsPerSecond", () => {
  it("answers each kind and the total a second, without the reading's own command", () => {
    const before = { insert: 10, query: 100, update: 20, delete: 0, getmore: 0, command: 50 };
    const after = { insert: 20, query: 300, update: 40, delete: 2, getmore: 0, command: 71 };

    expect(opsPerSecond(before, after, 10)).toEqual({
      insert: 1,
      query: 20,
      update: 2,
      delete: 0.2,
      getmore: 0,
      command: 2,
      total: 25.2,
    });
  });

  it("counts a kind missing from a reading as none and never goes below zero", () => {
    expect(opsPerSecond({ command: 5 }, {}, 1)).toEqual({
      insert: 0,
      query: 0,
      update: 0,
      delete: 0,
      getmore: 0,
      command: 0,
      total: 0,
    });
  });
});

describe("RENDER_SIZES", () => {
  it("models Render's free, starter and standard instances", () => {
    expect(RENDER_SIZES.free).toEqual({ cpus: "0.1", memory: "512m", dollarsPerMonth: 0 });
    expect(Object.keys(RENDER_SIZES)).toEqual(["free", "starter", "standard"]);
  });
});
