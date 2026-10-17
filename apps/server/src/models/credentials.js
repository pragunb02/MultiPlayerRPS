import { ValidationError } from "../utils/errors.js";
import { isOffensiveName, isReservedName } from "./publicName.js";

const USERNAME = /^[A-Za-z0-9_]{3,20}$/;
// Pragmatic email shape check; real verification is sending an email (CC-033).
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
export const PASSWORD_LENGTH = Object.freeze({ min: 8, max: 128 });

export const RESERVED_NAME = "That name is reserved. Please choose another name.";
export const UNSUITABLE_NAME =
  "Please choose another name. Names are shown to everyone, so keep it friendly.";

const invalid = (field, message) => new ValidationError(message, { details: { field } });

/**
 * Usernames are public (rooms, leaderboards), so they must not pass as staff, a bot or a game, and must not be
 * rude. The messages stay kind and never say which word caused the refusal (CC-119).
 *
 * @param {unknown} raw
 * @returns {string} the username as typed (case is kept for display, and uniqueness ignores case)
 */
export function parseUsername(raw) {
  if (typeof raw !== "string" || !USERNAME.test(raw)) {
    throw invalid("username", "Usernames are 3–20 letters, numbers or underscores");
  }
  if (isReservedName(raw)) {
    throw invalid("username", RESERVED_NAME);
  }
  if (isOffensiveName(raw)) {
    throw invalid("username", UNSUITABLE_NAME);
  }
  return raw;
}

/**
 * The one spelling of an email that every comparison uses: sign-up, login, the legacy lookup and the login limits
 * (CC-245). Spaces around it go. Unicode NFKC turns full-width letters from phone keyboards into normal ones and
 * joins an accent typed as two characters into one. The whole address is lower-cased, because the mail providers
 * our players use ignore case, and `Riya@` and `riya@` being two accounts would only confuse them. NFKC runs again
 * after lower-casing, because lower-casing can in rare cases leave a form NFKC would still change.
 *
 * Gmail dots and plus addresses are kept as typed. Other providers treat them as different mailboxes, and a plus
 * address is how some people keep two accounts on purpose (see CC-245).
 *
 * @param {unknown} raw  anything a client sent
 * @returns {string} the normalised text, or "" when it is not text. It is not checked to be an email.
 */
export function normaliseEmail(raw) {
  return typeof raw === "string" ? raw.normalize("NFKC").trim().toLowerCase().normalize("NFKC") : "";
}

// Control, invisible formatting and unassigned characters. Nobody can see them, so an address holding one looks the
// same as the address without it.
const INVISIBLE = /\p{C}/u;

/**
 * @param {unknown} raw
 * @returns {string} the email in its one spelling (see normaliseEmail)
 */
export function parseEmail(raw) {
  const email = normaliseEmail(raw);
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email) || INVISIBLE.test(email)) {
    throw invalid("email", "Enter a valid email address");
  }
  return email;
}

/**
 * @param {unknown} raw
 * @returns {string} the password, unchanged (never trimmed or logged)
 */
export function parsePassword(raw) {
  if (typeof raw !== "string" || raw.length < PASSWORD_LENGTH.min || raw.length > PASSWORD_LENGTH.max) {
    throw invalid("password", `Passwords are ${PASSWORD_LENGTH.min}–${PASSWORD_LENGTH.max} characters`);
  }
  if (raw.trim().length === 0) {
    throw invalid("password", "Passwords cannot be only spaces");
  }
  return raw;
}
