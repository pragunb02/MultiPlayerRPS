import { setTimeout as sleep } from "node:timers/promises";
import { TooManyRequestsError } from "../../utils/errors.js";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// Above this many remembered keys, the ones that no longer matter are dropped, so memory stays small. That walks
// every key, so it happens at most once a minute, however many logins arrive.
const PRUNE_ABOVE = 10_000;
const PRUNE_EVERY_MS = MINUTE_MS;

/**
 * How failed logins are slowed down and stopped (CC-117). The point is that guessing a password is hard, while
 * nobody can lock a real player out of their own account from somewhere else (SEC-16).
 *
 * 1. One address may get the password of one email wrong `failuresPerEmailAndAddress` times in `windowMs`. After
 *    that, that address is refused for that email until the window ends, even with the right password. Other
 *    addresses are not affected, so the real player can still sign in from home while an attacker is blocked.
 * 2. When one email gets `failuresPerEmail` wrong passwords in `windowMs` from all addresses together, someone is
 *    probably trying many addresses at once. Then every attempt for that email from an address that has not
 *    signed in to it before waits `slowDownMs` before it is checked. Nobody is refused: the right password still
 *    signs in, only a little slower, and an address that signed in to this email within `knownAddressMs` does not
 *    wait at all.
 * 3. The limit of 20 requests per address for every sign-up and login together stays on top of this (authRoutes.js).
 */
export const LOGIN_THROTTLE = Object.freeze({
  windowMs: 15 * MINUTE_MS,
  failuresPerEmailAndAddress: 5,
  failuresPerEmail: 10,
  slowDownMs: 2_000,
  knownAddressMs: 30 * DAY_MS,
  knownAddressesPerEmail: 10,
});

/** @typedef {typeof LOGIN_THROTTLE} LoginThrottleLimits */

/**
 * The counts behind the rules above. They live in this process: a restart forgets the failures and the known
 * addresses together, so nobody is ever blocked by a count that outlived the reason for it.
 *
 * @param {{
 *   limits?: LoginThrottleLimits,
 *   now?: () => number,
 *   wait?: (ms: number) => Promise<unknown>,
 *   pruneAbove?: number,
 * }} [deps]  `now` and `wait` are injectable so tests run without real time passing, and `pruneAbove` so a test
 *   can watch old keys being dropped without remembering ten thousand of them
 */
export function createLoginThrottle({
  limits = LOGIN_THROTTLE,
  now = Date.now,
  wait = sleep,
  pruneAbove = PRUNE_ABOVE,
} = {}) {
  /** @type {Map<string, { failures: number, endsAt: number }>} */
  const failures = new Map();
  /** @type {Map<string, Map<string, number>>} email to the addresses that signed in to it, and when */
  const known = new Map();
  let prunedAt = now();

  const pairKey = (email, address) => `${email}\n${address}`;
  const emailKey = (email) => `${email}\n`;

  function failuresOf(key) {
    const entry = failures.get(key);
    return entry !== undefined && now() < entry.endsAt ? entry.failures : 0;
  }

  function countFailure(key) {
    const current = failuresOf(key);
    const endsAt = current === 0 ? now() + limits.windowMs : failures.get(key).endsAt;
    failures.set(key, { failures: current + 1, endsAt });
  }

  function isKnown(email, address) {
    const signedInAt = known.get(email)?.get(address);
    return signedInAt !== undefined && now() - signedInAt < limits.knownAddressMs;
  }

  function prune() {
    if (now() - prunedAt < PRUNE_EVERY_MS) return;
    prunedAt = now();
    if (failures.size > pruneAbove) {
      for (const [key, entry] of failures) if (now() >= entry.endsAt) failures.delete(key);
    }
    if (known.size > pruneAbove) {
      for (const [email, addresses] of known) {
        for (const [address, at] of addresses)
          if (now() - at >= limits.knownAddressMs) addresses.delete(address);
        if (addresses.size === 0) known.delete(email);
      }
    }
  }

  return Object.freeze({
    /**
     * Call before checking the password. Refuses an address that guessed wrong too often for this email, and
     * makes an unknown address wait while the email is under attack.
     *
     * @param {{ email: string, address: string }} attempt  `email` normalised, `address` a rate limit key
     * @returns {Promise<void>}
     * @throws {TooManyRequestsError}
     */
    async before({ email, address }) {
      if (failuresOf(pairKey(email, address)) >= limits.failuresPerEmailAndAddress) {
        throw new TooManyRequestsError("Too many attempts, try again later");
      }
      if (failuresOf(emailKey(email)) >= limits.failuresPerEmail && !isKnown(email, address)) {
        await wait(limits.slowDownMs);
      }
    },

    /** @param {{ email: string, address: string }} attempt  the password was wrong (or the email unknown) */
    failed({ email, address }) {
      prune();
      countFailure(pairKey(email, address));
      countFailure(emailKey(email));
    },

    /**
     * The password was right. This address is now known for this email, and its own failures are forgiven. The
     * failures of the email from everywhere stay, because an attack on it may still be going on.
     *
     * @param {{ email: string, address: string }} attempt
     */
    succeeded({ email, address }) {
      prune();
      failures.delete(pairKey(email, address));
      const addresses = known.get(email) ?? new Map();
      addresses.delete(address);
      addresses.set(address, now());
      // Only the most recent addresses are kept. A Map keeps the order things were added in.
      while (addresses.size > limits.knownAddressesPerEmail) addresses.delete(addresses.keys().next().value);
      known.set(email, addresses);
    },

    /** @returns {{ counts: number, emails: number }} how much is remembered, so tests can see old keys go */
    remembered: () => ({ counts: failures.size, emails: known.size }),
  });
}
