import { BOT_CHARACTERS, IDENTITY_KINDS } from "@classicade/shared";

// Every kind of player id is written down here, its prefix and its whole pattern, so the code that makes an id
// and the last check that hides one can never disagree (CC-304).

/** How a guest's player id starts. */
export const GUEST_ID_PREFIX = "guest_";
/** How an account's player id starts. */
export const ACCOUNT_ID_PREFIX = "user_";
/** How a computer player's id starts. People's ids start with `guest_` or `user_`. */
export const BOT_ID_PREFIX = "bot_";
/** How the id of a deleted player's stand-in starts. People's ids start with `guest_` or `user_`. */
export const DELETED_ID_PREFIX = "deleted_";

/** Every player id prefix. No chosen name may start with one, so a name never looks like an id (CC-304). */
export const PLAYER_ID_PREFIXES = Object.freeze([
  GUEST_ID_PREFIX,
  ACCOUNT_ID_PREFIX,
  BOT_ID_PREFIX,
  DELETED_ID_PREFIX,
]);

/** The kind of id a deleted player's stand-in has. It is not a kind of identity anyone signs in as. */
export const DELETED_ID_KIND = "deleted";

// A computer player's id is one character at one of its levels, so only those pairs are ids.
const BOT_PAIRS = BOT_CHARACTERS.flatMap((character) =>
  character.levels.map((level) => `${character.id}_${level.id}`),
);
// Lowercase, as `randomUUID` writes it.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The whole pattern of each kind of player id, by kind. */
export const PLAYER_ID_PATTERNS = Object.freeze({
  [IDENTITY_KINDS.GUEST]: new RegExp(`^${GUEST_ID_PREFIX}[0-9a-f-]{36}$`),
  [IDENTITY_KINDS.USER]: new RegExp(`^${ACCOUNT_ID_PREFIX}[0-9a-f]{24}$`),
  [IDENTITY_KINDS.BOT]: new RegExp(`^${BOT_ID_PREFIX}(?:${BOT_PAIRS.join("|")})$`),
  [DELETED_ID_KIND]: new RegExp(`^${DELETED_ID_PREFIX}${UUID}$`),
});

const PATTERNS = Object.freeze(Object.values(PLAYER_ID_PATTERNS));

/**
 * Whether a value is, as a whole, shaped like a player id: a guest, an account, a computer player or a deleted
 * player's stand-in. Room views and match history use it as a last check, so a player id that nobody listed is
 * still never sent (CC-253). A name that only starts like an id, such as `user_bob`, is not one (CC-304). It says
 * nothing about whether such a player exists.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export const hasPlayerIdShape = (value) =>
  typeof value === "string" && PATTERNS.some((pattern) => pattern.test(value));
