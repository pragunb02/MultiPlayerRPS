import { describe, expect, it } from "vitest";
import { createTtlCache } from "./ttlCache.js";

const counter = () => {
  let calls = 0;
  const make = async () => ++calls;
  return { make, calls: () => calls };
};

describe("createTtlCache", () => {
  it("keeps a value until it expires, then makes it again", async () => {
    const cache = createTtlCache({ ttlMs: 1000, maxEntries: 10 });
    const work = counter();

    expect(await cache.remember({ key: "a", now: 0, make: work.make })).toBe(1);
    expect(await cache.remember({ key: "a", now: 999, make: work.make })).toBe(1);
    expect(await cache.remember({ key: "a", now: 1000, make: work.make })).toBe(2);
    expect(work.calls()).toBe(2);
  });

  it("shares one piece of work between requests that arrive while it runs", async () => {
    const cache = createTtlCache({ ttlMs: 1000, maxEntries: 10 });
    const work = counter();

    const [first, second] = await Promise.all([
      cache.remember({ key: "a", now: 0, make: work.make }),
      cache.remember({ key: "a", now: 1, make: work.make }),
    ]);

    expect([first, second]).toEqual([1, 1]);
    expect(work.calls()).toBe(1);
  });

  it("forgets a failure, so the next request tries again", async () => {
    const cache = createTtlCache({ ttlMs: 1000, maxEntries: 10 });
    const failing = cache.remember({ key: "a", now: 0, make: () => Promise.reject(new Error("down")) });
    await expect(failing).rejects.toThrow("down");

    expect(await cache.remember({ key: "a", now: 1, make: async () => "up" })).toBe("up");
  });

  it("keeps a newer value when an older failure settles late", async () => {
    const cache = createTtlCache({ ttlMs: 10, maxEntries: 10 });
    let fail;
    const failing = cache.remember({
      key: "a",
      now: 0,
      make: () => new Promise((resolve, reject) => (fail = reject)),
    });
    await cache.remember({ key: "a", now: 20, make: async () => "fresh" });
    fail(new Error("late"));
    await expect(failing).rejects.toThrow("late");

    expect(await cache.remember({ key: "a", now: 21, make: async () => "other" })).toBe("fresh");
  });

  it("drops the oldest entry when it is full", async () => {
    const cache = createTtlCache({ ttlMs: 1000, maxEntries: 2 });
    const work = counter();
    await cache.remember({ key: "a", now: 0, make: work.make });
    await cache.remember({ key: "b", now: 0, make: work.make });
    await cache.remember({ key: "c", now: 0, make: work.make });

    expect(await cache.remember({ key: "b", now: 1, make: work.make })).toBe(2);
    expect(await cache.remember({ key: "a", now: 1, make: work.make })).toBe(4);
  });

  it("refuses a cache that could hold nothing", () => {
    expect(() => createTtlCache({ ttlMs: 0, maxEntries: 1 })).toThrow(RangeError);
    expect(() => createTtlCache({ ttlMs: 1, maxEntries: 0 })).toThrow(RangeError);
  });
});
