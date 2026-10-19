import { describe, expect, it } from "vitest";

import { createRecorder, percentile, summarize } from "./stats.mjs";

describe("percentile", () => {
  it("answers 0 for no values", () => {
    expect(percentile([], 95)).toBe(0);
  });

  it("answers the nearest rank", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);

    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 100)).toBe(100);
  });
});

describe("summarize", () => {
  it("sums up times in any order, to a tenth of a millisecond", () => {
    expect(summarize([3.14159, 1, 2])).toEqual({ count: 3, p50: 2, p95: 3.1, p99: 3.1, max: 3.1 });
  });

  it("sums up no times as zeros", () => {
    expect(summarize([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe("createRecorder", () => {
  it("hands over a step's times, failures and counts, with every move together, and starts again empty", () => {
    const recorder = createRecorder();
    recorder.time("game:move rps", 10);
    recorder.time("game:move chess", 30);
    recorder.time("room:create rps", 5);
    recorder.fail("room:create SERVER_BUSY");
    recorder.fail("room:create SERVER_BUSY");
    recorder.count("games rps people");

    const step = recorder.take();

    expect(step.moves).toEqual({ count: 2, p50: 10, p95: 30, p99: 30, max: 30 });
    expect(Object.keys(step.times)).toEqual(["game:move chess", "game:move rps", "room:create rps"]);
    expect(step.failures).toEqual({ "room:create SERVER_BUSY": 2 });
    expect(step.counts).toEqual({ "games rps people": 1 });
    expect(recorder.take()).toEqual({
      moves: { count: 0, p50: 0, p95: 0, p99: 0, max: 0 },
      times: {},
      failures: {},
      counts: {},
    });
  });
});
