import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a media query matches now, followed live (a turned tablet, a resized window). Read during render, so the
 * first frame already has the right answer and nothing jumps.
 *
 * @param {string} query  such as `(min-width: 64rem)`
 * @returns {boolean}
 */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
