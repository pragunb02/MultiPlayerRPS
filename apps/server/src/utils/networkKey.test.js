import { createHmac, hkdfSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_ENV } from "../testing/testConfig.js";
import { createNetworkKey, dropOldNetworkKeysEveryMidnight } from "./networkKey.js";

const DAY = 24 * 60 * 60 * 1000;
const ADDRESS = "ip:203.0.113.7";
const NOON = Date.UTC(2026, 9, 18, 12);
const hashWith = (key, address = ADDRESS) =>
  createHmac("sha256", key).update(address).digest("hex").slice(0, 16);

/** A clock the test moves by hand. */
function clockAt(start) {
  let time = start;
  return { now: () => time, moveTo: (at) => (time = at) };
}

/** Random keys that the test can see: the first is all ones, the second all twos, and so on. */
function countedKeys() {
  const made = [];
  return {
    made,
    randomKey: () => {
      made.push(Buffer.alloc(32, made.length + 1));
      return made.at(-1);
    },
  };
}

describe("createNetworkKey (CC-107, CC-249)", () => {
  it("gives the same short name for the same address on the same day, and never the address itself", () => {
    const { networkOf } = createNetworkKey({ now: () => NOON });

    expect(networkOf(ADDRESS).name).toBe(networkOf(ADDRESS).name);
    expect(networkOf(ADDRESS).name).toMatch(/^[0-9a-f]{16}$/);
    expect(networkOf(ADDRESS).name).not.toBe(networkOf("ip:203.0.113.8").name);
    expect(Object.isFrozen(networkOf(ADDRESS))).toBe(true);
  });

  it("gives the same address a new name when the UTC day changes", () => {
    const clock = clockAt(Date.UTC(2026, 9, 18, 0, 0));
    const { networkOf } = createNetworkKey({ now: clock.now });
    const earlyToday = networkOf(ADDRESS).name;

    clock.moveTo(Date.UTC(2026, 9, 18, 23, 59, 59, 999));
    const lateToday = networkOf(ADDRESS).name;
    clock.moveTo(Date.UTC(2026, 9, 19, 0, 0));
    const tomorrow = networkOf(ADDRESS).name;

    expect(lateToday).toBe(earlyToday);
    expect(tomorrow).not.toBe(earlyToday);
  });

  it("cannot be worked out again from the session secret, because the day's key is random", () => {
    const one = createNetworkKey({ now: () => NOON }).networkOf(ADDRESS).name;
    const two = createNetworkKey({ now: () => NOON }).networkOf(ADDRESS).name;
    const fromSecretAndDay = hkdfSync("sha256", TEST_ENV.SESSION_SECRET, "2026-10-18", "network", 32);

    expect(one).not.toBe(two);
    expect(one).not.toBe(hashWith(TEST_ENV.SESSION_SECRET));
    expect(one).not.toBe(hashWith(Buffer.from(fromSecretAndDay)));
  });

  it("makes one new random key per day", () => {
    const clock = clockAt(NOON);
    const keys = countedKeys();
    const { networkOf } = createNetworkKey({ now: clock.now, randomKey: keys.randomKey });

    networkOf(ADDRESS);
    networkOf("ip:198.51.100.1");
    clock.moveTo(NOON + DAY);
    const tomorrow = networkOf(ADDRESS);

    expect(keys.made).toHaveLength(2);
    expect(tomorrow.name).toBe(hashWith(keys.made[1]));
  });

  it("also names the address under yesterday's key, so rooms opened before midnight still count", () => {
    const clock = clockAt(NOON);
    const { networkOf } = createNetworkKey({ now: clock.now });
    const yesterday = networkOf(ADDRESS).name;

    clock.moveTo(NOON + DAY);

    expect(networkOf(ADDRESS).earlier).toEqual([yesterday]);
    expect(Object.isFrozen(networkOf(ADDRESS).earlier)).toBe(true);
  });

  it("has no earlier name when no key was made yesterday", () => {
    const { networkOf } = createNetworkKey({ now: () => NOON });

    expect(networkOf(ADDRESS).earlier).toEqual([]);
  });

  it("drops a day's key at the second midnight after it, even when nobody asks for a name", () => {
    const clock = clockAt(NOON);
    const keys = countedKeys();
    const networkKey = createNetworkKey({ now: clock.now, randomKey: keys.randomKey });
    networkKey.networkOf(ADDRESS);

    clock.moveTo(NOON + DAY);
    networkKey.dropOldKeys();
    expect(networkKey.days()).toBe(1);
    clock.moveTo(NOON + 2 * DAY);
    networkKey.dropOldKeys();

    expect(networkKey.days()).toBe(0);
    expect(networkKey.networkOf(ADDRESS).earlier).toEqual([]);
  });

  it("drops a key from a day after today, if the clock is ever set back", () => {
    const clock = clockAt(NOON + DAY);
    const networkKey = createNetworkKey({ now: clock.now });
    networkKey.networkOf(ADDRESS);

    clock.moveTo(NOON);
    networkKey.dropOldKeys();

    expect(networkKey.days()).toBe(0);
  });

  it("makes no key until the first address is named", () => {
    const keys = countedKeys();

    createNetworkKey({ now: () => NOON, randomKey: keys.randomKey });

    expect(keys.made).toEqual([]);
  });

  it("needs a clock", () => {
    expect(() => createNetworkKey({})).toThrow(TypeError);
  });
});

describe("dropOldNetworkKeysEveryMidnight (CC-249)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops the old keys at every UTC midnight, and stops when asked", () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 18, 23, 0) });
    const drops = [];
    const networkKey = { dropOldKeys: () => drops.push(new Date(Date.now()).toISOString()) };

    const rotation = dropOldNetworkKeysEveryMidnight({ networkKey, now: Date.now });
    vi.advanceTimersByTime(DAY + 60 * 60 * 1000);
    rotation.stop();
    vi.advanceTimersByTime(2 * DAY);

    expect(drops).toEqual(["2026-10-19T00:00:00.000Z", "2026-10-20T00:00:00.000Z"]);
  });

  it("never waits less than a second, so a timer that fires a moment early cannot spin", () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 18, 23, 59, 59, 999) });
    const drops = [];
    const networkKey = { dropOldKeys: () => drops.push(Date.now()) };

    const rotation = dropOldNetworkKeysEveryMidnight({ networkKey, now: Date.now });
    vi.advanceTimersByTime(999);
    expect(drops).toEqual([]);
    vi.advanceTimersByTime(1);
    rotation.stop();

    expect(drops).toEqual([Date.UTC(2026, 9, 19, 0, 0, 0, 999)]);
  });

  it("does not keep the process alive", () => {
    vi.useFakeTimers({ now: NOON });
    const unref = vi.spyOn(globalThis, "setTimeout");

    const rotation = dropOldNetworkKeysEveryMidnight({
      networkKey: { dropOldKeys: () => {} },
      now: Date.now,
    });

    expect(unref.mock.results[0].value.hasRef()).toBe(false);
    rotation.stop();
  });
});
