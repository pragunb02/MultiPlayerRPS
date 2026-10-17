import { useEffect, useMemo, useRef, useState } from "react";

const TICK_MS = 1_000;

/**
 * Milliseconds left until `until`, a moment on the server's clock, refreshed every second. The view that named
 * the moment also says what time it was on the server (`serverTime`), and the browser only measures how long
 * ago that view arrived. A wrong clock on this device therefore never shows a wrong countdown. Calls
 * `onElapsed` once when the moment has come.
 *
 * @param {{ until: number, serverTime: number, onElapsed: () => void, now?: () => number }} input
 * @returns {number} never negative
 */
export function useServerCountdown({ until, serverTime, onElapsed, now = Date.now }) {
  // When this view arrived, in local time. A new view from the server starts the measurement again.
  const receivedAt = useMemo(() => now(), [serverTime, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const [localNow, setLocalNow] = useState(receivedAt);
  // The latest callback, so a new function from the parent does not restart the timer.
  const elapsedRef = useRef(onElapsed);
  useEffect(() => {
    elapsedRef.current = onElapsed;
  });

  useEffect(() => {
    const leftAt = (local) => until - (serverTime + Math.max(0, local - receivedAt));
    const start = now();
    if (leftAt(start) <= 0) {
      // The moment can pass between the render and this effect on a busy device, and the count must still reach 0.
      const timer = setTimeout(() => setLocalNow(start), 0);
      elapsedRef.current();
      return () => clearTimeout(timer);
    }
    const timer = setInterval(() => {
      const local = now();
      setLocalNow(local);
      if (leftAt(local) <= 0) {
        clearInterval(timer);
        elapsedRef.current();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [until, serverTime, receivedAt, now]);

  return Math.max(0, until - (serverTime + Math.max(0, localNow - receivedAt)));
}

/**
 * "12:34" or "1:02:03": whole seconds left, rounded up so the countdown shows 0:00 only when time is up.
 *
 * @param {number} ms
 */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
