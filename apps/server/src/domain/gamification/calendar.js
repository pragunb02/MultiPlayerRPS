/** UTC calendar days ("YYYY-MM-DD"): quests reset and daily streaks count at 00:00 UTC for everyone (ADR-013). */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {number} ms  a time in ms since the epoch
 * @returns {string} its UTC day, "YYYY-MM-DD"
 */
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * @param {string} day  "YYYY-MM-DD"
 * @returns {number} 00:00:00.000 UTC of that day, in ms
 */
export const startOfUtcDay = (day) => Date.parse(`${day}T00:00:00.000Z`);

/**
 * @param {string} day  "YYYY-MM-DD"
 * @param {number} days  may be negative
 * @returns {string} the day `days` later
 */
export const addDays = (day, days) => utcDay(startOfUtcDay(day) + days * DAY_MS);

/**
 * @param {number} ms
 * @returns {number} the next 00:00 UTC strictly after `ms` (exactly midnight counts as the new day's start)
 */
export const nextUtcMidnight = (ms) => startOfUtcDay(utcDay(ms)) + DAY_MS;
