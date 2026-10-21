/**
 * A moment as a clock time in the browser's own time zone, such as "12:00 am" (CC-146: reset times in local time).
 * The same words as the daily puzzle's "Next puzzle at".
 *
 * @param {number} ms
 * @param {string} [timeZone]  only tests pass one; the app uses the browser's
 * @returns {string}
 */
export const clockTime = (ms, timeZone) =>
  new Date(ms).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone && { timeZone }),
  });
