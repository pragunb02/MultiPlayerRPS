/** What an email address in a feedback message becomes before it is stored (CC-290, ADR-059). */
export const EMAIL_MASK = "[email removed]";

/** What a phone number in a feedback message becomes before it is stored. */
export const PHONE_MASK = "[phone removed]";

// Something before an @, and a domain with at least one dot after it.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// One character that may sit between two groups of a phone number. Never a new line, and never two in a row.
const SEPARATOR = "[ ,/_.-]";

// The shape of an Indian phone number: +91, 91 or 0 in front if at all, then groups of 3 to 5 digits with at most
// one separator between them. A score such as 3-2, a date or a time has groups that are too short, so it never fits.
const PHONE_SHAPE = new RegExp(
  `(?<![\\d+])(?:\\+?91${SEPARATOR}?|0${SEPARATOR}?)?\\d{3,5}(?:${SEPARATOR}?\\d{3,5}){1,3}(?!\\d)`,
  "g",
);

/** Whether the digits of a phone shape make a number: 10 digits, or 10 after 91 or after 0. */
function isPhoneNumber(shape) {
  const digits = shape.replace(/\D/g, "");
  return (
    digits.length === 10 ||
    (digits.length === 12 && digits.startsWith("91")) ||
    (digits.length === 11 && digits.startsWith("0"))
  );
}

const ANY_DIGIT = /\p{Nd}/u;

/**
 * The value of a decimal digit of any script. Unicode puts every script's digits in runs of ten from 0 to 9, so the
 * value is how far the digit is from the start of its run, counted in tens.
 */
function digitValue(digit) {
  const code = digit.codePointAt(0);
  let start = code;
  while (ANY_DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
  return String((code - start) % 10);
}

/**
 * The message with every email address and phone number replaced by a marker, so contact details a player typed by
 * mistake are never stored. Digits of any script (Devanagari, Bengali, full width) are stored as plain digits
 * first, so a number written in them is caught too. The reply email field is separate and is not touched by this.
 *
 * @param {string} message
 * @returns {string}
 */
export function maskContacts(message) {
  return message
    .replace(/\p{Nd}/gu, digitValue)
    .replace(EMAIL, EMAIL_MASK)
    .replace(PHONE_SHAPE, (shape) => (isPhoneNumber(shape) ? PHONE_MASK : shape));
}
