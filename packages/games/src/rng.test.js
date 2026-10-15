import { describe, expect, it } from "vitest";
import { createSeededRng, randomIndex } from "./rng.js";

const take = (rng, n) => Array.from({ length: n }, () => rng());

describe("createSeededRng", () => {
  it("produces the same sequence for the same seed", () => {
    expect(take(createSeededRng(123), 5)).toEqual(take(createSeededRng(123), 5));
  });

  it("produces different sequences for different seeds", () => {
    expect(take(createSeededRng(1), 5)).not.toEqual(take(createSeededRng(2), 5));
  });

  it("is pinned to a known sequence, so replays stay valid across releases", () => {
    expect(take(createSeededRng(1), 3).map((n) => n.toFixed(6))).toEqual([
      "0.627074",
      "0.002736",
      "0.527447",
    ]);
  });

  it("stays within [0, 1) and is roughly uniform", () => {
    const values = take(createSeededRng(99), 10_000);

    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it.each([1.5, "1", undefined])("rejects a non-integer seed (%o)", (seed) => {
    expect(() => createSeededRng(seed)).toThrow(TypeError);
  });
});

describe("randomIndex", () => {
  it("returns every index in range, and nothing outside it", () => {
    const rng = createSeededRng(5);
    const seen = new Set(Array.from({ length: 500 }, () => randomIndex(rng, 3)));

    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});
