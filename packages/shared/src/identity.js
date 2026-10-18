/**
 * Who a player is. Guests exist only in their session. Users have an account (CC-076). Bots are computer characters
 * the server seats in a room (ADR-025). No session can ever hold a bot.
 */
export const IDENTITY_KINDS = Object.freeze({
  GUEST: "guest",
  USER: "user",
  BOT: "bot",
});
