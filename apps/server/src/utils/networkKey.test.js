import { createHmac, hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TEST_ENV } from "../testing/testConfig.js";
import { createNetworkKey } from "./networkKey.js";

const DAY = 24 * 60 * 60 * 1000;
const ADDRESS = "ip:203.0.113.7";
const NOON = Date.UTC(2026, 9, 18, 12);

/** A clock the test moves by hand. */
function clockAt(start) {
  let time = start;
  return { now: () => time, moveTo: (at) => (time = at) };
}

describe("createNetworkKey (CC-107, CC-249)", () => {
  it("gives the same short name for the same address on the same day, and never the address itself", () => {
    const networkOf = createNetworkKey({ now: () => NOON });

    expect(networkOf(ADDRESS)).toBe(networkOf(ADDRESS));
    expect(networkOf(ADDRESS)).toMatch(/^[0-9a-f]{16}$/);
    expect(networkOf(ADDRESS)).not.toBe(networkOf("ip:203.0.113.8"));
  });

  it("gives the same address a new name when the UTC day changes", () => {
    const clock = clockAt(Date.UTC(2026, 9, 18, 0, 0));
    const networkOf = createNetworkKey({ now: clock.now });
    const earlyToday = networkOf(ADDRESS);

    clock.moveTo(Date.UTC(2026, 9, 18, 23, 59, 59, 999));
    const lateToday = networkOf(ADDRESS);
    clock.moveTo(Date.UTC(2026, 9, 19, 0, 0));
    const tomorrow = networkOf(ADDRESS);

    expect(lateToday).toBe(earlyToday);
    expect(tomorrow).not.toBe(earlyToday);
  });

  it("cannot be worked out again from the session secret, because the day's key is random", () => {
    const one = createNetworkKey({ now: () => NOON });
    const two = createNetworkKey({ now: () => NOON });
    const hash = (key) => createHmac("sha256", key).update(ADDRESS).digest("hex").slice(0, 16);
    const fromSecretAndDay = hkdfSync("sha256", TEST_ENV.SESSION_SECRET, "2026-10-18", "network", 32);

    expect(one(ADDRESS)).not.toBe(two(ADDRESS));
    expect(one(ADDRESS)).not.toBe(hash(TEST_ENV.SESSION_SECRET));
    expect(one(ADDRESS)).not.toBe(hash(Buffer.from(fromSecretAndDay)));
  });

  it("makes one new random key per day and keeps no other", () => {
    const clock = clockAt(NOON);
    const made = [];
    const networkOf = createNetworkKey({
      now: clock.now,
      randomKey: () => {
        made.push(Buffer.alloc(32, made.length + 1));
        return made.at(-1);
      },
    });

    networkOf(ADDRESS);
    networkOf("ip:198.51.100.1");
    clock.moveTo(NOON + DAY);
    const tomorrow = networkOf(ADDRESS);

    expect(made).toHaveLength(2);
    expect(tomorrow).toBe(createHmac("sha256", made[1]).update(ADDRESS).digest("hex").slice(0, 16));
  });

  it("makes no key until the first address is named", () => {
    const made = [];

    createNetworkKey({ now: () => NOON, randomKey: () => made.push(1) });

    expect(made).toEqual([]);
  });

  it("needs a clock", () => {
    expect(() => createNetworkKey({})).toThrow(TypeError);
  });
});
