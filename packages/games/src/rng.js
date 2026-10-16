/**
 * Pseudo-random numbers that come out the same every time for the same seed (mulberry32). Engines never call
 * `Math.random`: the caller passes in an RNG, so a game can be replayed exactly from its seed and tests give the
 * same result on every run.
 *
 * @typedef {() => number} Rng  returns a float in [0, 1)
 */

/**
 * @param {number} seed  32-bit integer
 * @returns {Rng}
 */
export function createSeededRng(seed) {
  if (!Number.isInteger(seed)) {
    throw new TypeError("seed must be an integer");
  }
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {Rng} rng
 * @param {number} maxExclusive
 * @returns {number} integer in [0, maxExclusive)
 */
export function randomIndex(rng, maxExclusive) {
  return Math.floor(rng() * maxExclusive);
}
