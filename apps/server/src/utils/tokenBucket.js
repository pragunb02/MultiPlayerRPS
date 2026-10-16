/**
 * Token-bucket rate limiter: allows bursts up to `capacity`, refilling at `refillPerSecond`.
 * Used per socket so one client cannot flood the server with events.
 *
 * @param {{ capacity: number, refillPerSecond: number, now?: () => number }} options  `now` injectable for tests
 */
export function createTokenBucket({ capacity, refillPerSecond, now = Date.now }) {
  if (!(capacity > 0) || !(refillPerSecond > 0)) {
    throw new TypeError("capacity and refillPerSecond must be positive");
  }
  let tokens = capacity;
  let last = now();

  return Object.freeze({
    /** @returns {boolean} true if the action is allowed (and consumes a token) */
    tryTake() {
      const current = now();
      tokens = Math.min(capacity, tokens + ((current - last) / 1000) * refillPerSecond);
      last = current;
      if (tokens < 1) {
        return false;
      }
      tokens -= 1;
      return true;
    },
  });
}
