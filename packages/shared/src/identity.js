/**
 * Who a player is. Guests exist only in their session. Users have an account (CC-076). Bots are computer characters
 * the server seats in a room (ADR-025). No session can ever hold a bot.
 */
export const IDENTITY_KINDS = Object.freeze({
  GUEST: "guest",
  USER: "user",
  BOT: "bot",
});

/**
 * Why the server refused a name, in `details.reason`, so the page can say it in its own words (CC-350). The
 * refusal never says which word caused it (CC-119).
 */
export const NAME_REFUSALS = Object.freeze({
  /** it passes as staff, a computer player or a game */
  RESERVED: "reserved-name",
  /** it is rude */
  UNSUITABLE: "unsuitable-name",
});

/** Why the server refused a password, in `details.reason` (CC-350). */
export const ACCOUNT_REFUSALS = Object.freeze({
  /** the password given to confirm a download or a deletion is not the account's */
  WRONG_PASSWORD: "wrong-password",
  /** the current password given to change it is not the account's */
  WRONG_CURRENT_PASSWORD: "wrong-current-password",
  /** the year of birth says the player is under 13, so they keep playing as a guest (CC-152) */
  TOO_YOUNG: "too-young",
});

/** Why the server refused a new password, at sign-up or on a change, in `details.reason` (CC-350). */
export const PASSWORD_REFUSALS = Object.freeze({
  /** attackers already know it: it is on the common list or in a breach (CC-261) */
  EASY: "easy-password",
  /** it is shorter or longer than a password may be */
  LENGTH: "password-length",
  /** it is only spaces */
  ONLY_SPACES: "password-only-spaces",
  /** a change to the same password the account has */
  SAME_AS_CURRENT: "same-as-current",
});

/**
 * Account messages that the server sends and the web app shows with links of its own. They live here so both say
 * exactly the same words.
 *
 * `EMAIL_UNAVAILABLE` answers every sign-up whose email cannot be used: one that has an account, or one of a player
 * of the old app, in any spelling. It is one message for all of them, so sign-up never tells them apart, and it
 * points the real owner to logging in (CC-238). Password reset comes with CC-033, so until then a player who forgot
 * theirs is sent to the Feedback form, which they can use (CC-350, CL-92).
 */
export const ACCOUNT_MESSAGES = Object.freeze({
  EMAIL_UNAVAILABLE:
    "That email can't be used. If it's yours, log in. Forgot your password? Tell us with Feedback and we'll help.",
});
