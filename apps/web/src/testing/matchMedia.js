/**
 * A fake `window.matchMedia` that only knows `prefers-reduced-motion`. Returns a controller so tests can switch
 * the setting while a component is mounted, like a player changing it in their system settings.
 *
 * @param {{ reducedMotion?: boolean }} [options]
 */
export function installMatchMedia({ reducedMotion = false } = {}) {
  let reduce = reducedMotion;
  const listeners = new Set();
  window.matchMedia = (query) => ({
    media: query,
    get matches() {
      return query === "(prefers-reduced-motion: reduce)" && reduce;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  });
  return {
    /** @param {boolean} value */
    setReducedMotion(value) {
      reduce = value;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}
