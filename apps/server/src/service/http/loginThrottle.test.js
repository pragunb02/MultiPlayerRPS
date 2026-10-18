import { describe, expect, it } from "vitest";
import { TooManyRequestsError } from "../../utils/errors.js";
import { createLoginThrottle, LOGIN_THROTTLE } from "./loginThrottle.js";

const EMAIL = "riya@example.com";
const HOME = "ip:203.0.113.7";
const ATTACKER = "ip:198.51.100.66";
const MINUTE = 60_000;

function setup(limits = LOGIN_THROTTLE) {
  let time = 0;
  const waits = [];
  const throttle = createLoginThrottle({
    limits,
    now: () => time,
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  const failTimes = (count, attempt) => {
    for (let i = 0; i < count; i++) throttle.failed(attempt);
  };
  return { throttle, waits, failTimes, advance: (ms) => (time += ms) };
}

describe("login throttle (CC-117)", () => {
  it("allows five wrong passwords per email and address in 15 minutes, ten per email before slowing down", () => {
    expect(LOGIN_THROTTLE).toEqual({
      windowMs: 15 * MINUTE,
      failuresPerEmailAndAddress: 5,
      failuresPerEmail: 10,
      slowDownMs: 2_000,
      knownAddressMs: 30 * 24 * 60 * MINUTE,
      knownAddressesPerEmail: 10,
    });
    expect(Object.isFrozen(LOGIN_THROTTLE)).toBe(true);
  });

  describe("one email from one address", () => {
    it("lets the fifth wrong attempt through and refuses the sixth", async () => {
      const { throttle, failTimes } = setup();
      failTimes(4, { email: EMAIL, address: ATTACKER });

      await expect(throttle.before({ email: EMAIL, address: ATTACKER })).resolves.toBeUndefined();
      throttle.failed({ email: EMAIL, address: ATTACKER });

      await expect(throttle.before({ email: EMAIL, address: ATTACKER })).rejects.toThrow(
        TooManyRequestsError,
      );
    });

    it("refuses the blocked address even with the right password, until the window ends", async () => {
      const { throttle, failTimes, advance } = setup();
      failTimes(5, { email: EMAIL, address: ATTACKER });

      advance(15 * MINUTE - 1);
      await expect(throttle.before({ email: EMAIL, address: ATTACKER })).rejects.toThrow(
        "Too many attempts, try again later",
      );
      advance(1);

      await expect(throttle.before({ email: EMAIL, address: ATTACKER })).resolves.toBeUndefined();
    });

    it("counts the window from the first failure, not the last", async () => {
      const { throttle, failTimes, advance } = setup();
      failTimes(4, { email: EMAIL, address: ATTACKER });
      advance(14 * MINUTE);
      throttle.failed({ email: EMAIL, address: ATTACKER });
      await expect(throttle.before({ email: EMAIL, address: ATTACKER })).rejects.toThrow(
        TooManyRequestsError,
      );

      advance(MINUTE);

      await expect(throttle.before({ email: EMAIL, address: ATTACKER })).resolves.toBeUndefined();
    });

    it("forgives an address its own failures once it signs in", async () => {
      const { throttle, failTimes } = setup();
      failTimes(4, { email: EMAIL, address: HOME });

      throttle.succeeded({ email: EMAIL, address: HOME });
      failTimes(4, { email: EMAIL, address: HOME });

      await expect(throttle.before({ email: EMAIL, address: HOME })).resolves.toBeUndefined();
    });
  });

  describe("an attacker cannot lock the real player out", () => {
    it("blocks only the attacker's address: the player's home address still gets in", async () => {
      const { throttle, failTimes, waits } = setup();
      failTimes(5, { email: EMAIL, address: ATTACKER });

      await expect(throttle.before({ email: EMAIL, address: ATTACKER })).rejects.toThrow(
        TooManyRequestsError,
      );
      await expect(throttle.before({ email: EMAIL, address: HOME })).resolves.toBeUndefined();
      expect(waits).toEqual([]);
    });

    it("makes unknown addresses wait, but never refuses them, once the email has ten failures from anywhere", async () => {
      const { throttle, waits } = setup();
      for (let i = 0; i < 10; i++) throttle.failed({ email: EMAIL, address: `ip:10.0.0.${i}` });

      await expect(throttle.before({ email: EMAIL, address: "ip:192.0.2.1" })).resolves.toBeUndefined();

      expect(waits).toEqual([2_000]);
    });

    it("does not slow down before the tenth failure", async () => {
      const { throttle, waits } = setup();
      for (let i = 0; i < 9; i++) throttle.failed({ email: EMAIL, address: `ip:10.0.0.${i}` });

      await throttle.before({ email: EMAIL, address: "ip:192.0.2.1" });

      expect(waits).toEqual([]);
    });

    it("lets an address that signed in to this email before in without waiting", async () => {
      const { throttle, waits, advance } = setup();
      throttle.succeeded({ email: EMAIL, address: HOME });
      advance(29 * 24 * 60 * MINUTE);
      for (let i = 0; i < 20; i++) throttle.failed({ email: EMAIL, address: `ip:10.0.0.${i}` });

      await throttle.before({ email: EMAIL, address: HOME });

      expect(waits).toEqual([]);
    });

    it("forgets a known address after thirty days", async () => {
      const { throttle, waits, advance } = setup();
      throttle.succeeded({ email: EMAIL, address: HOME });
      advance(30 * 24 * 60 * MINUTE);
      for (let i = 0; i < 10; i++) throttle.failed({ email: EMAIL, address: `ip:10.0.0.${i}` });

      await throttle.before({ email: EMAIL, address: HOME });

      expect(waits).toEqual([2_000]);
    });

    it("keeps the email's failures after a sign-in, because the attack may still be going on", async () => {
      const { throttle, waits } = setup();
      for (let i = 0; i < 10; i++) throttle.failed({ email: EMAIL, address: `ip:10.0.0.${i}` });

      throttle.succeeded({ email: EMAIL, address: HOME });
      await throttle.before({ email: EMAIL, address: "ip:192.0.2.1" });

      expect(waits).toEqual([2_000]);
    });

    it("never affects another email", async () => {
      const { throttle, failTimes, waits } = setup();
      failTimes(20, { email: EMAIL, address: ATTACKER });

      await expect(throttle.before({ email: "sam@example.com", address: ATTACKER })).resolves.toBeUndefined();
      expect(waits).toEqual([]);
    });
  });

  it("remembers only the ten most recent addresses of an email", async () => {
    const { throttle, waits } = setup();
    throttle.succeeded({ email: EMAIL, address: HOME });
    for (let i = 0; i < 10; i++) throttle.succeeded({ email: EMAIL, address: `ip:10.1.0.${i}` });
    throttle.succeeded({ email: EMAIL, address: "ip:10.1.0.0" }); // signing in again moves it to the front
    for (let i = 0; i < 10; i++) throttle.failed({ email: EMAIL, address: `ip:10.0.0.${i}` });

    await throttle.before({ email: EMAIL, address: "ip:10.1.0.0" });
    await throttle.before({ email: EMAIL, address: HOME });

    expect(waits).toEqual([2_000]);
  });

  it("drops counts and addresses that no longer matter once it remembers many, at most once a minute", () => {
    let time = 0;
    const throttle = createLoginThrottle({ now: () => time, pruneAbove: 2 });
    for (let i = 0; i < 3; i++) throttle.failed({ email: `p${i}@example.com`, address: ATTACKER });
    for (let i = 0; i < 3; i++) throttle.succeeded({ email: `p${i}@example.com`, address: HOME });
    throttle.succeeded({ email: "p0@example.com", address: "ip:10.9.9.9" });
    expect(throttle.remembered()).toEqual({ counts: 6, emails: 3 });
    time += 30 * 24 * 60 * MINUTE;

    throttle.failed({ email: EMAIL, address: ATTACKER });
    expect(throttle.remembered()).toEqual({ counts: 2, emails: 0 });
    time += 30_000;
    for (let i = 0; i < 3; i++) throttle.succeeded({ email: `q${i}@example.com`, address: HOME });

    expect(throttle.remembered()).toEqual({ counts: 2, emails: 3 });
  });

  it("keeps what is still current when it prunes", () => {
    let time = 0;
    const throttle = createLoginThrottle({ now: () => time, pruneAbove: 1 });
    throttle.succeeded({ email: "old@example.com", address: HOME });
    time += 29 * 24 * 60 * MINUTE;
    throttle.succeeded({ email: EMAIL, address: HOME });
    throttle.failed({ email: EMAIL, address: ATTACKER });
    time += 2 * MINUTE;

    throttle.failed({ email: EMAIL, address: ATTACKER });

    expect(throttle.remembered()).toEqual({ counts: 2, emails: 2 });
  });

  describe("what it holds (CC-250)", () => {
    it("holds no email and no address, only keyed hashes", () => {
      const { throttle, failTimes } = setup();
      failTimes(3, { email: EMAIL, address: ATTACKER });
      throttle.succeeded({ email: EMAIL, address: HOME });
      throttle.succeeded({ email: "sam@example.com", address: HOME });

      const keys = throttle.keys();

      expect(keys.length).toBeGreaterThanOrEqual(5);
      for (const key of keys) {
        expect(key).toMatch(/^[\w-]{22}$/);
        for (const plain of ["riya", "sam", "example", "203.0.113.7", "198.51.100.66"]) {
          expect(key).not.toContain(plain);
        }
      }
    });

    it("gives the same address a different name for every email, so two emails cannot be linked by it", () => {
      const { throttle } = setup();
      throttle.succeeded({ email: EMAIL, address: HOME });
      throttle.succeeded({ email: "sam@example.com", address: HOME });

      const keys = throttle.keys();

      expect(new Set(keys).size).toBe(keys.length);
    });

    it("hashes with a random key of its own, so the same login gives other names in another process", () => {
      const keysWith = (randomKey) => {
        const throttle = createLoginThrottle({ ...(randomKey && { randomKey }) });
        throttle.failed({ email: EMAIL, address: ATTACKER });
        return throttle.keys();
      };

      expect(keysWith(() => Buffer.alloc(32, 1))).toEqual(keysWith(() => Buffer.alloc(32, 1)));
      expect(keysWith(() => Buffer.alloc(32, 1))).not.toEqual(keysWith(() => Buffer.alloc(32, 2)));
      expect(keysWith()).not.toEqual(keysWith());
    });
  });

  it("waits for real by default", async () => {
    const throttle = createLoginThrottle({
      limits: { ...LOGIN_THROTTLE, failuresPerEmail: 1, slowDownMs: 5 },
    });
    throttle.failed({ email: EMAIL, address: ATTACKER });
    const started = Date.now();

    await throttle.before({ email: EMAIL, address: HOME });

    expect(Date.now() - started).toBeGreaterThanOrEqual(4);
  });
});
