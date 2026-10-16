import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/**
 * Milliseconds left until `target`, refreshed once a minute (enough for "5h 12m"). Calls `onElapsed` once the
 * target passes — e.g. to load the next day's quests. A target that is already over (this device's clock runs
 * ahead of the server's) is retried a minute later, never in a tight loop.
 *
 * @param {{ target: number, onElapsed: () => void, now?: () => number }} options
 * @returns {number}
 */
export function useCountdown({ target, onElapsed, now = Date.now }) {
  const [current, setCurrent] = useState(now);

  useEffect(() => {
    if (now() >= target) {
      const later = setTimeout(onElapsed, MINUTE_MS);
      return () => clearTimeout(later);
    }
    const timer = setInterval(() => {
      const time = now();
      setCurrent(time);
      if (time >= target) {
        clearInterval(timer);
        onElapsed();
      }
    }, MINUTE_MS);
    return () => clearInterval(timer);
  }, [target, onElapsed, now]);

  return Math.max(0, target - current);
}
