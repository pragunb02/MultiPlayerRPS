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
 * Account messages that the server sends and the web app shows with links of its own. They live here so both say
 * exactly the same words.
 *
 * `EMAIL_UNAVAILABLE` answers every sign-up whose email cannot be used: one that has an account, or one of a player
 * of the old app, in any spelling. It is one message for all of them, so sign-up never tells them apart, and it
 * points the real owner to logging in (CC-238). Password reset comes with CC-033.
 */
export const ACCOUNT_MESSAGES = Object.freeze({
  EMAIL_UNAVAILABLE: "That email can't be used. If it's yours, log in or reset your password.",
});
