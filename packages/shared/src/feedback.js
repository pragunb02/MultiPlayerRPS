/**
 * The lists in-app feedback is made of (CC-290, ADR-059). The dialog, the server's checks and the owner console all
 * read them here, so adding a type or a status is one line in this file.
 */

/** What a player can say they are sending, in the order the dialog shows them. */
export const FEEDBACK_TYPES = Object.freeze(["bug", "idea", "other"]);

/** Where an item is in the owner's inbox. Every new item starts at the first one. */
export const FEEDBACK_STATUSES = Object.freeze(["new", "read", "done"]);

/** The coarse device class the page attaches. Never a user agent or a screen size (ADR-059). */
export const FEEDBACK_DEVICES = Object.freeze(["phone", "tablet", "desktop"]);

/** Who sent it, as the server's session says: no session, a guest or an account. Never a player id. */
export const FEEDBACK_KINDS = Object.freeze(["visitor", "guest", "account"]);

/** The longest message, in UTF-16 units, which is what a text box's `maxLength` counts. */
export const FEEDBACK_MESSAGE_MAX = 1000;

/** How long an item is kept after it was sent. MongoDB removes it after that (ADR-059). */
export const FEEDBACK_KEEP_DAYS = 180;
