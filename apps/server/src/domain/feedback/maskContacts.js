/** What an email address in a feedback message becomes before it is stored (CC-290, ADR-059). */
export const EMAIL_MASK = "[email removed]";

/** What a phone number in a feedback message becomes before it is stored. */
export const PHONE_MASK = "[phone removed]";

// Something before an @, and a domain with at least one dot after it.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// A run of digits that may hold spaces, hyphens, dots or brackets between them, with an optional + or bracket in
// front. It is a phone number when it holds at least 10 digits: an Indian mobile has 10, with +91 or 0 in front it
// has 12 or 11. Scores, dates, times and room codes have far fewer.
const DIGIT_RUN = /[+(]?\d[\d\s().-]{7,}\d/g;
const PHONE_DIGITS = 10;

const digitsIn = (text) => text.replace(/\D/g, "").length;

/**
 * The message with every email address and phone number replaced by a marker, so contact details a player typed by
 * mistake are never stored. The reply email field is separate and is not touched by this.
 *
 * @param {string} message
 * @returns {string}
 */
export function maskContacts(message) {
  return message
    .replace(EMAIL, EMAIL_MASK)
    .replace(DIGIT_RUN, (run) => (digitsIn(run) >= PHONE_DIGITS ? PHONE_MASK : run));
}
