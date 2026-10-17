import { BOT_CHARACTERS, BOT_ID_PREFIX, IDENTITY_KINDS, isBotPlayerId } from "@classicade/shared";
import { ValidationError } from "../utils/errors.js";

/**
 * A computer character in one seat (ADR-025, CC-138). It has the same three fields as a person's identity, so a room
 * seats it like anyone else, plus `bot`, which every view carries so the character is always labelled as a computer.
 * The id is the same for every game the character plays at that level, so the fair play limits can count its games.
 *
 * @typedef {Object} BotIdentity
 * @property {"bot"} kind
 * @property {string} id            `bot_<character>_<level>`, for example `bot_rocky_easy`
 * @property {string} displayName   the character's name
 * @property {Readonly<{ character: string, level: string }>} bot   which character, and which level pick
 */

/**
 * The identity of one character at one level pick.
 *
 * @param {{ gameId: string, level: string }} pick  `level` is a level pick id of the game's character, such as "easy"
 * @returns {Readonly<BotIdentity>}
 * @throws {ValidationError} when the game has no character or the character has no such level
 */
export function botIdentity({ gameId, level }) {
  const character = BOT_CHARACTERS.find((entry) => entry.gameId === gameId);
  if (character === undefined) {
    throw new ValidationError("There is no computer player for that game", { details: { field: "gameId" } });
  }
  if (!character.levels.some((entry) => entry.id === level)) {
    throw new ValidationError("Pick one of the computer player's levels", { details: { field: "level" } });
  }
  return Object.freeze({
    kind: /** @type {"bot"} */ (IDENTITY_KINDS.BOT),
    id: `${BOT_ID_PREFIX}${character.id}_${level}`,
    displayName: character.name,
    bot: Object.freeze({ character: character.id, level }),
  });
}

/**
 * Who a player counts as for the limit of games against one opponent (ADR-021, ADR-025). A person is themself. A
 * computer character is one opponent at every level, so switching levels never resets the limit.
 *
 * @param {string} playerId
 */
export function opponentKey(playerId) {
  return isBotPlayerId(playerId) ? playerId.slice(0, playerId.lastIndexOf("_")) : playerId;
}

export { isBotPlayerId };
