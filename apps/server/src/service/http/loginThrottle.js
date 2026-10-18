import { createHmac, randomBytes } from "node:crypto";
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
 * No email and no address is kept, only keyed hashes of them (CC-250). The throttle only ever asks whether it has
 * seen the same email, or the same email and address, before, and a hash answers that just as well. The key is
 * random and made with the throttle, so it dies with the counts, and a memory dump holds nothing that can be turned
 * back into a player's email or where they sign in from.
 *
 * @param {{
 *   limits?: LoginThrottleLimits,
 *   now?: () => number,
 *   wait?: (ms: number) => Promise<unknown>,
 *   pruneAbove?: number,
 *   randomKey?: () => Buffer,
 * }} [deps]  `now` and `wait` are injectable so tests run without real time passing, `pruneAbove` so a test
 *   can watch old keys being dropped without remembering ten thousand of them, and `randomKey` so a test can give
 *   two throttles the same key
 */
export function createLoginThrottle({
  limits = LOGIN_THROTTLE,
  now = Date.now,
  wait = sleep,
  pruneAbove = PRUNE_ABOVE,
  randomKey = () => randomBytes(32),
} = {}) {
  const key = randomKey();
  /** @type {Map<string, { failures: number, endsAt: number }>} */
  const failures = new Map();
  /** @type {Map<string, Map<string, number>>} the hash of an email, to the pairs that signed in to it and when */
  const known = new Map();
  let prunedAt = now();

  // Each hash says what it is for, and the parts go in as a JSON array, so no email or address can be split in a
  // way that gives another one's hash. 16 bytes are plenty: two different inputs sharing a hash will not happen.
  const hash = (...parts) =>
    createHmac("sha256", key).update(JSON.stringify(parts)).digest().subarray(0, 16).toString("base64url");
  // A known address is kept under the hash of the pair, not of the address alone, so two emails that signed in
  // from the same place cannot be linked through the throttle.
  const pairKey = (email, address) => hash("pair", email, address);
  const emailKey = (email) => hash("email", email);

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
    const signedInAt = known.get(emailKey(email))?.get(pairKey(email, address));
    return signedInAt !== undefined && now() - signedInAt < limits.knownAddressMs;
  }

  function prune() {
    if (now() - prunedAt < PRUNE_EVERY_MS) return;
    prunedAt = now();
    if (failures.size > pruneAbove) {
      for (const [key, entry] of failures) if (now() >= entry.endsAt) failures.delete(key);
    }
    if (known.size > pruneAbove) {
      for (const [email, pairs] of known) {
        for (const [pair, at] of pairs) if (now() - at >= limits.knownAddressMs) pairs.delete(pair);
        if (pairs.size === 0) known.delete(email);
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
      const pair = pairKey(email, address);
      failures.delete(pair);
      const pairs = known.get(emailKey(email)) ?? new Map();
      pairs.delete(pair);
      pairs.set(pair, now());
      // Only the most recent addresses are kept. A Map keeps the order things were added in.
      while (pairs.size > limits.knownAddressesPerEmail) pairs.delete(pairs.keys().next().value);
      known.set(emailKey(email), pairs);
    },

    /** @returns {{ counts: number, emails: number }} how much is remembered, so tests can see old keys go */
    remembered: () => ({ counts: failures.size, emails: known.size }),

    /** @returns {string[]} every key it holds, so a test can check that none is an email or an address (CC-250) */
    keys: () => [...failures.keys(), ...[...known].flatMap(([email, pairs]) => [email, ...pairs.keys()])],
  });
}
