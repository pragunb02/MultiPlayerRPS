import { DELETED_PLAYER_NAME } from "@classicade/shared";
import { isBotPlayerId } from "./botIdentity.js";
import { DELETED_ID_PREFIX } from "./playerIdShape.js";

export { DELETED_ID_PREFIX } from "./playerIdShape.js";

/**
 * The anonymous stand-in that takes a deleted player's place in a shared match or an open room (CC-035). Each
 * match gets a new one, so the anonymous matches cannot be put back together into one person's history.
 *
 * @param {string} uuid  a fresh random id
 * @returns {Readonly<{ id: string, displayName: string }>}
 */
export const deletedPlayer = (uuid) =>
  Object.freeze({ id: `${DELETED_ID_PREFIX}${uuid}`, displayName: DELETED_PLAYER_NAME });

/** @param {string} playerId */
export const isDeletedPlayerId = (playerId) => playerId.startsWith(DELETED_ID_PREFIX);

/**
 * Whether a seat earns nothing from a match: a computer character (ADR-025), or a deleted player's stand-in, who
 * must not get progress, stats or quests written for them after the deletion.
 *
 * @param {string} playerId
 */
export const earnsNothing = (playerId) => isBotPlayerId(playerId) || isDeletedPlayerId(playerId);
