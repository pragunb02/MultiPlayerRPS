import { BOT_CHARACTERS, ROOM_STATUS } from "@classicade/shared";
import { botIdentity } from "../../models/botIdentity.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { GoneError, NotFoundError } from "../../utils/errors.js";
import { ROOM_EVENTS } from "../rooms/roomComponent.js";

/**
 * How many games against computer characters one player can have going at once. Each computer move costs the server
 * a little thinking (a strong chess level up to a quarter of a second), so one player must not be able to keep many
 * going. Starting one more ends the oldest, which counts as leaving it.
 */
export const MAX_COMPUTER_GAMES = 3;

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

/** The room closed meanwhile: there is nothing left to end. */
const isGone = (err) => err instanceof NotFoundError || err instanceof GoneError;

/**
 * Starting a game against a computer character (CC-138, CC-221): a room is created for the player and the character
 * takes the other seat at once, so the game starts straight away. Asking a friend instead stays the room component's
 * usual create and join.
 *
 * @param {{
 *   roomComponent: Pick<ReturnType<typeof import("../rooms/roomComponent.js").createRoomComponent>, "createRoom" | "joinRoom" | "leaveRoom">,
 *   roomAccessor: Pick<ReturnType<typeof import("../../data/roomAccessor.js").createRoomAccessor>, "listBySeat">,
 *   events: { emit: (event: string, payload: unknown) => void },
 * }} deps
 */
export function createBotComponent({ roomComponent, roomAccessor, events }) {
  assertDefined(roomComponent, "roomComponent");
  assertFunction(roomAccessor?.listBySeat, "roomAccessor.listBySeat");
  assertFunction(events?.emit, "events.emit");

  /** Ends the player's oldest games against computers, so one more fits within MAX_COMPUTER_GAMES. */
  async function endOldestGames({ playerId, now }) {
    const going = (await roomAccessor.listBySeat(playerId))
      .filter(
        (room) => room.status === ROOM_STATUS.PLAYING && room.seats.some((seat) => seat.bot !== undefined),
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const old of going.slice(0, Math.max(0, going.length - MAX_COMPUTER_GAMES + 1))) {
      try {
        const result = await roomComponent.leaveRoom({ code: old.code, playerId, now });
        // Another tab of the player may still show it: it hears the game is over.
        if (!result.closed) events.emit(ROOM_EVENTS.UPDATED, { room: result.room });
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    }
  }

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
      // The new room waits for the computer until the old games are ended, so it is never one of them.
      const room = await roomComponent.createRoom({ host, gameId, options, now });
      await endOldestGames({ playerId: host.id, now });
      return roomComponent.joinRoom({ code: room.code, player: bot, now });
    },
  });
}
