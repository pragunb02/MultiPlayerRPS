/**
 * Birth years for tests that run on the real clock (CC-325). A fixed year such as 2010 is a minor's today and an
 * adult's in a few years, so a test that needs a minor would start failing on some future day. These are counted
 * back from the year of `now`, so they stay a minor's and an adult's on any day the tests run. A test with its own
 * fixed clock may keep fixed years.
 */

/**
 * The birth year of a 15 year old: old enough for an account, surely under 18.
 *
 * @param {number} [now]
 */
export const minorBirthYear = (now = Date.now()) => new Date(now).getUTCFullYear() - 15;

/**
 * The birth year of a 30 year old: surely an adult.
 *
 * @param {number} [now]
 */
export const adultBirthYear = (now = Date.now()) => new Date(now).getUTCFullYear() - 30;
