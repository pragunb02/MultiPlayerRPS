const MINUTE_MS = 60_000;

/**
 * "Resets in 5h 12m" — whole minutes, rounded up so it never says "0m" while time is left.
 *
 * @param {number} remainingMs
 */
export function resetsIn(remainingMs) {
  if (remainingMs <= 0) {
    return "Resetting now…";
  }
  const minutes = Math.ceil(remainingMs / MINUTE_MS);
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `Resets in ${minutes}m` : `Resets in ${hours}h ${minutes % 60}m`;
}
