import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;

/**
 * Whether the player asked their system for less motion. Follows changes live, so switching the setting while a
 * page is open takes effect at once. Celebrations render nothing when this is true; their text stays (ADR-012).
 *
 * @returns {boolean}
 */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
