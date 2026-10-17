// The owner console shows totals only. A small group in a breakdown could point at one person ("the 2 players who
// unlocked Grandmaster this week"), so any count of people from 1 to 4 is replaced by a marker before it leaves
// the server. Zero is shown, because it points at nobody (CC-233).

/** The smallest group the console shows as a number. */
export const MIN_GROUP_SIZE = 5;

/** What the console shows instead of a count below MIN_GROUP_SIZE. The web app writes it as "fewer than 5". */
export const FEWER_THAN_MIN = "<5";

/**
 * A count of people, or the marker when the group is too small to show.
 *
 * @param {number} count
 * @returns {number | typeof FEWER_THAN_MIN}
 */
export const peopleCount = (count) => (count === 0 || count >= MIN_GROUP_SIZE ? count : FEWER_THAN_MIN);

/**
 * A share from 0 to 1, rounded to 4 decimals, or the marker when the group it is a share of is too small. Zero
 * people means there is no share to show, which is also the marker, so a rate never divides by zero.
 *
 * @param {{ part: number, whole: number }} counts
 * @returns {number | typeof FEWER_THAN_MIN}
 */
export function shareOf({ part, whole }) {
  if (whole < MIN_GROUP_SIZE) {
    return FEWER_THAN_MIN;
  }
  return round(part / whole);
}

/**
 * A share of things that are not people (matches), so it is shown for any non-empty total. Zero when there is
 * nothing to share.
 *
 * @param {{ part: number, whole: number }} counts
 * @returns {number}
 */
export const plainShare = ({ part, whole }) => (whole === 0 ? 0 : round(part / whole));

/**
 * The 95% margin of error of a share, in the same 0 to 1 units, for the cohort table (PRODUCT_VISION.md
 * section 7.2): 1.96 times the square root of p(1 minus p) over n.
 *
 * @param {{ share: number, size: number }} sample
 * @returns {number}
 */
export const marginOfError = ({ share, size }) => round(1.96 * Math.sqrt((share * (1 - share)) / size));

const round = (value) => Math.round(value * 10_000) / 10_000;
