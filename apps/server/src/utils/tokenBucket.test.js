import { describe, expect, it } from "vitest";
import { createTokenBucket } from "./tokenBucket.js";

function setup() {
  let time = 0;
  const bucket = createTokenBucket({ capacity: 3, refillPerSecond: 2, now: () => time });
  return { bucket, advance: (ms) => (time += ms) };
}

describe("createTokenBucket", () => {
  it("allows a burst up to capacity, then refuses", () => {
    const { bucket } = setup();

    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("refills over time at the configured rate", () => {
    const { bucket, advance } = setup();
    [1, 2, 3].forEach(() => bucket.tryTake());

    advance(500); // 2 per second → 1 token

    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it("never refills beyond capacity", () => {
    const { bucket, advance } = setup();

    advance(60_000);

    expect([1, 2, 3, 4].map(() => bucket.tryTake())).toEqual([true, true, true, false]);
  });

  it("knows when it has refilled completely", () => {
    const { bucket, advance } = setup();
    expect(bucket.isFull()).toBe(true);

    bucket.tryTake();
    expect(bucket.isFull()).toBe(false);
    advance(60_000);

    expect(bucket.isFull()).toBe(true);
  });

  it.each([
    { capacity: 0, refillPerSecond: 1 },
    { capacity: 1, refillPerSecond: 0 },
    { capacity: Number.NaN, refillPerSecond: 1 },
  ])("rejects invalid settings %o", (options) => {
    expect(() => createTokenBucket(options)).toThrow(TypeError);
  });
});
