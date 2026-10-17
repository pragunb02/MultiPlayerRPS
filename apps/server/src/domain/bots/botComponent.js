import { BOT_CHARACTERS } from "@classicade/shared";
import { botIdentity } from "../../models/botIdentity.js";
import { assertDefined } from "../../utils/assert.js";

/**
 * Every character must be playable: its game has a bot, and each of its level picks names one of that bot's levels.
 * Checked at start up, so a character that could never move is never offered.
 *
 * @param {ReturnType<typeof import("@classicade/games").createBotRegistry>} bots
 * @param {ReadonlyArray<{ id: string, gameId: string, levels: ReadonlyArray<{ id: string, botLevel: string }> }>} [characters]
 *   the catalog in `@classicade/shared` unless a test gives others
 */
export function assertCharactersPlayable(bots, characters = BOT_CHARACTERS) {
  const problems = characters.flatMap((character) => {
    if (!bots.has(character.gameId)) {
      return [`${character.id} plays ${character.gameId}, which has no bot`];
    }
    const known = bots.get(character.gameId).levels.map((level) => level.id);
    return character.levels
      .filter((level) => !known.includes(level.botLevel))
      .map((level) => `${character.id} ${level.id} names the unknown bot level ${level.botLevel}`);
  });
  if (problems.length > 0) {
    throw new Error(`Computer characters that cannot play: ${problems.join(", ")}`);
  }
}

/**
 * Starting a game against a computer character (CC-138, CC-221): a room is created for the player and the character
 * takes the other seat at once, so the game starts straight away. Asking a friend instead stays the room component's
 * usual create and join.
 *
 * @param {{ roomComponent: Pick<ReturnType<typeof import("../rooms/roomComponent.js").createRoomComponent>, "createRoom" | "joinRoom"> }} deps
 */
export function createBotComponent({ roomComponent }) {
  assertDefined(roomComponent, "roomComponent");

  return Object.freeze({
    /**
     * @param {{ host: import("../../models/identity.js").Identity, gameId: string, options: unknown, level: string, now: number }} input
     *   `level` is one of the character's level picks, such as "easy"
     * @returns {Promise<Readonly<import("../../data/roomAccessor.js").Room>>} the room, its game already started
     * @throws {import("../../utils/errors.js").ValidationError} for a game without a character, an unknown level or
     *   invalid options
     */
    async playComputer({ host, gameId, options, level, now }) {
      const bot = botIdentity({ gameId, level });
      const room = await roomComponent.createRoom({ host, gameId, options, now });
      return roomComponent.joinRoom({ code: room.code, player: bot, now });
    },
  });
}
