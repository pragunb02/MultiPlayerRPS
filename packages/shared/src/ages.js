/**
 * Age groups, worked out from a birth year only (CC-152, ADR-028). The year is all ClassiCade ever asks.
 *
 * 1. `adult`: this year minus the birth year is 19 or more, so the player is 18 already, whatever their birthday.
 * 2. `minor`: anything less. A player who turns 18 this year counts as a minor until 1 January, because their
 *    birthday may still be ahead. Not sure counts as a minor, like not known.
 * 3. `unknown`: no year was given. It gets the same safe defaults as a minor.
 */
export const AGE_GROUPS = Object.freeze({ ADULT: "adult", MINOR: "minor", UNKNOWN: "unknown" });

/** How many years back the year picker goes, counting this year as the first. */
export const BIRTH_YEAR_CHOICES = 101;

/** Accounts are for people aged 13 and over (the privacy page). A guest needs no age. */
export const MINIMUM_ACCOUNT_AGE = 13;

/** The years this year minus the birth year must reach before the player is surely 18. */
const SURELY_ADULT = 19;

/** Why an account is refused to someone under 13, said only after they chose a year. */
export const TOO_YOUNG_MESSAGE =
  "ClassiCade accounts are for people aged 13 and over. You can keep playing as a guest.";

/** What a public board shows instead of the name of a minor or an account of unknown age. */
export const HIDDEN_PLAYER_NAME = "Hidden player";

/** What a match shows instead of the name of a player who deleted their account (CC-035). */
export const DELETED_PLAYER_NAME = "Deleted player";

/**
 * The years a player can pick, this year first, in a plain list with no default and no hint about any age.
 *
 * @param {number} currentYear
 * @returns {ReadonlyArray<number>}
 */
export const birthYearChoices = (currentYear) =>
  Object.freeze(Array.from({ length: BIRTH_YEAR_CHOICES }, (_, index) => currentYear - index));

/**
 * @param {{ birthYear?: number, currentYear: number }} input  no `birthYear` when the player did not say
 * @returns {"adult" | "minor" | "unknown"}
 */
export function ageGroupFor({ birthYear, currentYear }) {
  if (birthYear === undefined) {
    return AGE_GROUPS.UNKNOWN;
  }
  return currentYear - birthYear >= SURELY_ADULT ? AGE_GROUPS.ADULT : AGE_GROUPS.MINOR;
}

/**
 * Whether the player is under 13 for the whole of this year, so cannot have an account. A player who turns 13 this
 * year may already be 13, so they may.
 *
 * @param {{ birthYear: number, currentYear: number }} input
 */
export const isTooYoungForAccount = ({ birthYear, currentYear }) =>
  currentYear - birthYear < MINIMUM_ACCOUNT_AGE;
