const REM = 16;
const WIDTH_QUERY = /^\((min|max)-width: ([\d.]+)(rem|px)\)$/;

/** Whether a `(min-width: …)` or `(max-width: …)` query matches a window `width` CSS pixels wide. */
function widthMatches(query, width) {
  const found = WIDTH_QUERY.exec(query);
  if (found === null) return false;
  const [, side, amount, unit] = found;
  const limit = Number(amount) * (unit === "rem" ? REM : 1);
  return side === "min" ? width >= limit : width <= limit;
}

/**
 * A fake `window.matchMedia` that knows `prefers-reduced-motion` and the window's width, for `(min-width: …)` and
 * `(max-width: …)` in rem or px. Returns a controller so tests can switch either while a component is mounted, like
 * a player changing a system setting or turning a tablet. The width starts at a laptop's 1280 px, so the header is
 * the wide one unless a test asks for a phone (CC-324).
 *
 * @param {{ reducedMotion?: boolean, width?: number }} [options]
 */
export function installMatchMedia({ reducedMotion = false, width = 1280 } = {}) {
  let reduce = reducedMotion;
  let windowWidth = width;
  const listeners = new Set();
  window.matchMedia = (query) => ({
    media: query,
    get matches() {
      if (query === "(prefers-reduced-motion: reduce)") return reduce;
      return widthMatches(query, windowWidth);
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
    /** @param {number} value  the window's new width in CSS pixels */
    setWidth(value) {
      windowWidth = value;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}
