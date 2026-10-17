/**
 * Token-bucket rate limiter: allows bursts up to `capacity`, refilling at `refillPerSecond`.
 * Used per player so one client cannot flood the server with events (CC-107).
 *
 * @param {{ capacity: number, refillPerSecond: number, now?: () => number }} options  `now` injectable for tests
 */
export function createTokenBucket({ capacity, refillPerSecond, now = Date.now }) {
  if (!(capacity > 0) || !(refillPerSecond > 0)) {
    throw new TypeError("capacity and refillPerSecond must be positive");
  }
  let tokens = capacity;
  let last = now();
  const refill = () => {
    const current = now();
    tokens = Math.min(capacity, tokens + ((current - last) / 1000) * refillPerSecond);
    last = current;
  };

  return Object.freeze({
    /** @returns {boolean} true if the action is allowed (and consumes a token) */
    tryTake() {
      refill();
      if (tokens < 1) {
        return false;
      }
      tokens -= 1;
      return true;
    },

    /** @returns {boolean} true when the bucket has refilled completely, so forgetting it would change nothing */
    isFull() {
      refill();
      return tokens >= capacity;
    },
  });
}
