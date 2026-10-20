import { BOT_ID_PREFIX } from "./botIdentity.js";
import { DELETED_ID_PREFIX } from "./deletedPlayer.js";
import { ACCOUNT_ID_PREFIX, GUEST_ID_PREFIX } from "./identity.js";

const PREFIXES = Object.freeze([GUEST_ID_PREFIX, ACCOUNT_ID_PREFIX, BOT_ID_PREFIX, DELETED_ID_PREFIX]);

/**
 * Whether a value starts the way every player id does: a guest, an account, a computer player or a deleted
 * player's stand-in. Room views use it as a last check, so a player id that nobody listed is still never sent
 * (CC-253). It says nothing about whether such a player exists.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export const hasPlayerIdShape = (value) =>
  typeof value === "string" && PREFIXES.some((prefix) => value.startsWith(prefix));
