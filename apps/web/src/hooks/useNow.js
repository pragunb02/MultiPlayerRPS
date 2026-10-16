import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs` — for countdowns that only need minute precision.
 *
 * @param {number} intervalMs
 */
export function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * "2d 4h", "5h 12m", "3m" — how long until a moment, for reset countdowns. Never negative.
 *
 * @param {number} ms  milliseconds left
 */
export function formatTimeLeft(ms) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
