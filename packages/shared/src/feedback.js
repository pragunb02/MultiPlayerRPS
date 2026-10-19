import { getLeaderboard } from "./leaderboards.js";
import { gameForSlug } from "./site.js";

/**
 * The names in-app feedback is made of (CC-290, ADR-059). The dialog, the server's checks and the owner console all
 * read them here, so adding a type or a status is one line in this file. Code uses the names, never a place in a
 * list, and the lists are only for showing every value in order.
 */

/** What a player can say they are sending. The dialog shows them in this order. */
export const FEEDBACK_TYPE = Object.freeze({ BUG: "bug", IDEA: "idea", OTHER: "other" });
export const FEEDBACK_TYPES = Object.freeze(Object.values(FEEDBACK_TYPE));

/** The type the dialog starts on. Most feedback during the friends launch is about something broken. */
export const FEEDBACK_DEFAULT_TYPE = FEEDBACK_TYPE.BUG;

/** Where an item is in the owner's inbox. */
export const FEEDBACK_STATUS = Object.freeze({ NEW: "new", READ: "read", DONE: "done" });
export const FEEDBACK_STATUSES = Object.freeze(Object.values(FEEDBACK_STATUS));

/** The status every item starts in. */
export const FEEDBACK_INITIAL_STATUS = FEEDBACK_STATUS.NEW;

/** The coarse device class the page attaches. Never a user agent or a screen size (ADR-059). */
export const FEEDBACK_DEVICE = Object.freeze({ PHONE: "phone", TABLET: "tablet", DESKTOP: "desktop" });
export const FEEDBACK_DEVICES = Object.freeze(Object.values(FEEDBACK_DEVICE));

/** Who sent it, as the server's session says: no session, a guest or an account. Never a player id. */
export const FEEDBACK_KIND = Object.freeze({ VISITOR: "visitor", GUEST: "guest", ACCOUNT: "account" });
export const FEEDBACK_KINDS = Object.freeze(Object.values(FEEDBACK_KIND));

/** The longest message, in UTF-16 units, which is what a text box's `maxLength` counts. */
export const FEEDBACK_MESSAGE_MAX = 1000;

/** How long an item is kept after it was sent. MongoDB removes it after that (ADR-059). */
export const FEEDBACK_KEEP_DAYS = 180;

const MAX_PAGE_LENGTH = 100;
const MAX_PAGE_SEGMENTS = 8;
// A word of the site's own addresses, such as "games" or "userprofile". It has no digits and no capitals, and room
// codes, names and ids always have one or the other.
const SITE_WORD = /^[a-z]+(?:-[a-z]+)*$/;
const PLACEHOLDER = /^:[a-z]+$/;

/**
 * Whether one part of a page is safe to keep: a placeholder, `*`, a game or a board from the catalog, which may hold
 * digits, or a word of the site's addresses. Anything else could be a code or a name.
 */
const isSafeSegment = (segment) =>
  segment === "*" ||
  PLACEHOLDER.test(segment) ||
  (segment === segment.toLowerCase() && gameForSlug(segment) !== undefined) ||
  getLeaderboard(segment) !== undefined ||
  SITE_WORD.test(segment);

/**
 * Whether a page a feedback item names is a route pattern that cannot point at a room or a player: `/`, or parts
 * that are each safe (see above). The page builds the pattern, and the server checks it with this same rule.
 *
 * @param {unknown} page
 * @returns {boolean}
 */
export function isFeedbackPage(page) {
  if (typeof page !== "string" || page.length > MAX_PAGE_LENGTH || !page.startsWith("/")) return false;
  if (page === "/") return true;
  const segments = page.slice(1).split("/");
  return segments.length <= MAX_PAGE_SEGMENTS && segments.every(isSafeSegment);
}
