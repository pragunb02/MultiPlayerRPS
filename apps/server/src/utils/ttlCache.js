/**
 * A small in-memory cache whose entries expire a fixed time after they were made. It keeps the promise of a
 * value, so several requests that arrive while the first one is still working share that one piece of work.
 * A failed piece of work is forgotten at once, so the next request tries again. When it is full, the oldest
 * entry goes first.
 *
 * @param {{ ttlMs: number, maxEntries: number }} options
 */
export function createTtlCache({ ttlMs, maxEntries }) {
  if (!(ttlMs > 0) || !(maxEntries > 0)) {
    throw new RangeError("A cache needs a positive ttlMs and maxEntries");
  }
  const entries = new Map();

  return Object.freeze({
    /**
     * The value stored under `key`, made by `make` when there is none or it has expired.
     *
     * @template T
     * @param {{ key: string, now: number, make: () => Promise<T> }} request
     * @returns {Promise<T>}
     */
    remember({ key, now, make }) {
      const entry = entries.get(key);
      if (entry !== undefined && entry.expiresAt > now) {
        return entry.value;
      }
      entries.delete(key);
      const value = make();
      entries.set(key, { value, expiresAt: now + ttlMs });
      value.catch(() => {
        if (entries.get(key)?.value === value) {
          entries.delete(key);
        }
      });
      if (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
      return value;
    },
  });
}
