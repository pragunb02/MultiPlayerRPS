/**
 * What a deploy is called (CC-303): the commit it was built from and a version made from that commit's day. The
 * build script that writes them and the server that shows them on `/health` share these rules, so a value one
 * accepts the other accepts too.
 */

/** What every part says when it cannot be known, such as on a laptop or in CI. */
export const UNKNOWN_BUILD = "unknown";

// A git commit sha as Render gives it: lower case hex, 7 to 40 characters, and nothing else.
const COMMIT = /^[0-9a-f]{7,40}$/;
const SHORT_SHA = 7;
const VERSION = /^(\d{4})\.(\d{2})\.(\d{2})\+([0-9a-f]{7})$/;

/**
 * The commit, when the value is one. Anything else is UNKNOWN_BUILD, so a stray environment value is never shown.
 *
 * @param {unknown} value
 * @returns {string}
 */
export const parseCommit = (value) =>
  typeof value === "string" && COMMIT.test(value) ? value : UNKNOWN_BUILD;

const twoDigits = (number) => String(number).padStart(2, "0");

/**
 * The version of a commit: the day it was committed, in UTC, and its short sha, such as `2026.10.20+a40ce5b` (owner,
 * 2026-10-20). It comes from the commit alone, so the same commit always has the same version and nothing has to
 * be counted or kept.
 *
 * @param {{ commit: string, committedAt: string }} source  `committedAt` is the commit's date as git gives it
 * @returns {string} the version, or UNKNOWN_BUILD
 */
export function calendarVersion({ commit, committedAt }) {
  const when = new Date(committedAt);
  if (parseCommit(commit) === UNKNOWN_BUILD || committedAt === "" || Number.isNaN(when.getTime())) {
    return UNKNOWN_BUILD;
  }
  const day = `${when.getUTCFullYear()}.${twoDigits(when.getUTCMonth() + 1)}.${twoDigits(when.getUTCDate())}`;
  return `${day}+${commit.slice(0, SHORT_SHA)}`;
}

/**
 * Whether a version has the calendar shape and names this commit, so a version written for another build is never
 * shown next to this one's commit.
 *
 * @param {unknown} version
 * @param {string} commit
 * @returns {boolean}
 */
export function isCalendarVersionOf(version, commit) {
  const match = typeof version === "string" ? VERSION.exec(version) : null;
  return match !== null && commit.startsWith(match[4]);
}
