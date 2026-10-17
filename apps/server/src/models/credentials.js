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
 * @param {unknown} raw
 * @returns {string} trimmed, lower-cased email
 */
export function parseEmail(raw) {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) {
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
