import { AGE_GROUPS } from "@classicade/shared";
import { INDIA_TIME_ZONE } from "../../utils/indiaTime.js";

/**
 * The under 18 social defaults, in one place (CC-152, ADR-028, ADR-048 amended 2026-10-20). Every social feature
 * reads a player's policy from here instead of working out an age itself, so a new feature cannot forget a rule.
 *
 * Who the player is:
 *
 * 1. `adult`: an account whose birth year makes it surely 18.
 * 2. `minor`: an account whose birth year does not.
 * 3. `unknown`: an account with no year, and anyone who is not a person we know, such as a computer character or a
 *    deleted player's stand-in. Unknown means minor (ADR-028.1).
 * 4. `guest`: no account. A minor too, with the two guest rules: no friends (CC-052) and the server-given name on
 *    the boards (ADR-060).
 */
export const AUDIENCES = Object.freeze({
  ADULT: "adult",
  MINOR: "minor",
  UNKNOWN: "unknown",
  GUEST: "guest",
});

/** How friends are made. Always mutual (ADR-028.2). */
export const FRIENDS_MODES = Object.freeze({
  /** Mutual, from any way the friends feature offers. */
  MUTUAL: "mutual",
  /** Mutual, and only from someone already met: a game played together or a friend link the player shared. */
  MUTUAL_KNOWN: "mutual-known",
  /** No friends at all: a guest (CC-052, owner). */
  NONE: "none",
});

/**
 * Whether quick match (CC-051, ADR-079) may pair the player with a stranger. `strangers` pairs them under the
 * quick match rules: never with a blocked player, the room marked as quick match so no friend request
 * (ADR-051.7) or challenge again (ADR-051.8) can follow from it, and no way to talk (ADR-028.6). `none` keeps the
 * player out of every search: Play starts the computer character at once.
 */
export const QUICK_MATCH_MODES = Object.freeze({ STRANGERS: "strangers", NONE: "none" });

/** In-game emotes (CC-169). */
export const EMOTES = Object.freeze({ ON: "on", OFF: "off" });

/** The name a public board shows on the player's row. */
export const BOARD_NAMES = Object.freeze({
  /** The username. */
  OWN: "own",
  /** The `Guest-XXXX` name the server gave, nothing the player chose (ADR-060). */
  SERVER_GIVEN: "server-given",
  /** "Hidden player" (ADR-048.10). */
  HIDDEN: "hidden",
});

/** No push and no email in these hours, India time (CC-052 rule 3). */
const QUIET_HOURS = Object.freeze({ timeZone: INDIA_TIME_ZONE, from: "22:00", to: "07:00" });

/** The biggest circle a person may own: circles are 2 to 50 (ADR-028.3), a minor's at most 10 (ADR-028.4.4). */
const CIRCLE_LIMIT = 50;
const MINOR_CIRCLE_LIMIT = 10;

const ADULT_POLICY = Object.freeze({
  treatedAsMinor: false,
  canFollow: true,
  canBeFollowed: true,
  friendsMode: FRIENDS_MODES.MUTUAL,
  quickMatch: QUICK_MATCH_MODES.STRANGERS,
  emotes: EMOTES.ON,
  quietHours: null,
  shareCardName: true,
  maxOwnedCircleSize: CIRCLE_LIMIT,
  publicProfile: true,
  profileLink: true,
  boardName: BOARD_NAMES.OWN,
  replyEmail: true,
  personalisation: true,
});

/** The high privacy defaults (ICO children's code standard 7), for anyone not surely an adult. */
const MINOR_POLICY = Object.freeze({
  treatedAsMinor: true,
  canFollow: false,
  canBeFollowed: false,
  friendsMode: FRIENDS_MODES.MUTUAL_KNOWN,
  // A minor plays strangers only under the quick match rules above: nothing can follow from the game (ADR-079.6).
  quickMatch: QUICK_MATCH_MODES.STRANGERS,
  emotes: EMOTES.OFF,
  quietHours: QUIET_HOURS,
  shareCardName: false,
  maxOwnedCircleSize: MINOR_CIRCLE_LIMIT,
  publicProfile: false,
  profileLink: false,
  boardName: BOARD_NAMES.HIDDEN,
  replyEmail: false,
  personalisation: false,
});

const POLICIES = Object.freeze({
  [AUDIENCES.ADULT]: Object.freeze({ audience: AUDIENCES.ADULT, ...ADULT_POLICY }),
  [AUDIENCES.MINOR]: Object.freeze({ audience: AUDIENCES.MINOR, ...MINOR_POLICY }),
  [AUDIENCES.UNKNOWN]: Object.freeze({ audience: AUDIENCES.UNKNOWN, ...MINOR_POLICY }),
  [AUDIENCES.GUEST]: Object.freeze({
    audience: AUDIENCES.GUEST,
    ...MINOR_POLICY,
    friendsMode: FRIENDS_MODES.NONE,
    boardName: BOARD_NAMES.SERVER_GIVEN,
  }),
});

/**
 * @typedef {typeof POLICIES[keyof typeof POLICIES]} AgePolicy
 */

/**
 * The policy of one audience.
 *
 * @param {string} audience  one of AUDIENCES
 * @returns {AgePolicy}
 * @throws {TypeError} for anything else, so a typo never falls back to some default
 */
export function agePolicyFor(audience) {
  if (!Object.hasOwn(POLICIES, audience)) {
    throw new TypeError(`Unknown audience: ${String(audience)}`);
  }
  return POLICIES[audience];
}

/**
 * Who a player is for the policy. Only an account can be an adult or a minor. A guest is always a guest, whatever it
 * says. Anything else is unknown.
 *
 * @param {{ kind: string, ageGroup?: string }} player  `ageGroup` from `ageGroupFor`, for an account
 * @returns {string} one of AUDIENCES
 */
export function audienceOf({ kind, ageGroup }) {
  if (kind === "guest") return AUDIENCES.GUEST;
  if (kind !== "account") return AUDIENCES.UNKNOWN;
  if (ageGroup === AGE_GROUPS.ADULT) return AUDIENCES.ADULT;
  if (ageGroup === AGE_GROUPS.MINOR) return AUDIENCES.MINOR;
  return AUDIENCES.UNKNOWN;
}

const INDIA_OFFSET_MINUTES = 5 * 60 + 30;
const minutesOf = (clock) => {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
};

/**
 * Whether `now` falls in the player's quiet hours, when nothing may push or email them. The hours cross midnight.
 *
 * @param {AgePolicy} policy
 * @param {number} now  ms since the epoch
 */
export function isQuietTime(policy, now) {
  if (policy.quietHours === null) return false;
  const dayMinutes = 24 * 60;
  const minute = (Math.floor(now / 60_000) + INDIA_OFFSET_MINUTES) % dayMinutes;
  const from = minutesOf(policy.quietHours.from);
  const to = minutesOf(policy.quietHours.to);
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
}

/**
 * What the player's own browser is told: the flags its features need, never the age group or which age would change
 * them, so nothing tells a child which age unlocks what (FTC COPPA FAQ, CC-152 research part 1).
 *
 * @param {AgePolicy} policy
 */
export const clientPolicyOf = (policy) =>
  Object.freeze({
    canFollow: policy.canFollow,
    friendsMode: policy.friendsMode,
    emotes: policy.emotes,
    quietHours: policy.quietHours,
    shareCardName: policy.shareCardName,
    maxOwnedCircleSize: policy.maxOwnedCircleSize,
    publicProfile: policy.publicProfile,
    boardName: policy.boardName,
  });
