import { BOT_CHARACTERS, ROOM_STATUS } from "@classicade/shared";
import { botIdentity } from "../../models/botIdentity.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { GoneError, NotFoundError } from "../../utils/errors.js";
import { ROOM_EVENTS } from "../rooms/roomComponent.js";

/**
 * How many games against computer characters one player can have going at once. Each computer move costs the server
 * a little thinking (a strong chess level up to a quarter of a second), so one player must not be able to keep many
 * going. Starting one more ends the oldest, which counts as leaving it. That holds for a new game and for a rematch.
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
 *   roomComponent: Pick<ReturnType<typeof import("../rooms/roomComponent.js").createRoomComponent>, "createRoom" | "joinRoom" | "leaveRoom" | "getRoom" | "requestRematch">,
 *   roomAccessor: Pick<ReturnType<typeof import("../../data/roomAccessor.js").createRoomAccessor>, "listBySeat">,
 *   events: { emit: (event: string, payload: unknown) => void },
 * }} deps
 */
export function createBotComponent({ roomComponent, roomAccessor, events }) {
  assertDefined(roomComponent, "roomComponent");
  assertFunction(roomAccessor?.listBySeat, "roomAccessor.listBySeat");
  assertFunction(events?.emit, "events.emit");

  /**
   * Each person's starts, one after another. Two starts at the same moment (two tabs, or many requests sent at
   * once) would each count the games going before either had started its own, and both would fit. In turn, each
   * one counts the other's game. The server runs as one process, so this line is the whole truth.
   */
  const lines = new Map();

  /** Runs `work` when the person's earlier starts are done. */
  function inTurn(playerId, work) {
    const turn = (lines.get(playerId) ?? Promise.resolve()).then(work);
    const settled = turn.then(
      () => undefined,
      () => undefined,
    );
    lines.set(playerId, settled);
    // The last start of a person also clears the line, so it does not stay in memory.
    settled.then(() => lines.get(playerId) === settled && lines.delete(playerId));
    return turn;
  }

  /**
   * Ends the person's oldest games against computers, so that with the game in room `keep`, which has just
   * started, at most MAX_COMPUTER_GAMES are going. Checked after the start, so nothing slips past while it starts.
   */
  async function endOldestGames({ playerId, keep, now }) {
    const going = (await roomAccessor.listBySeat(playerId))
      .filter(
        (room) =>
          room.code !== keep &&
          room.status === ROOM_STATUS.PLAYING &&
          room.seats.some((seat) => seat.bot !== undefined),
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
      return inTurn(host.id, async () => {
        const room = await roomComponent.createRoom({ host, gameId, options, now });
        const started = await roomComponent.joinRoom({ code: room.code, player: bot, now });
        await endOldestGames({ playerId: host.id, keep: room.code, now });
        return started;
      });
    },

    /**
     * A computer player says yes to the rematch the person asked for. When that starts a new game, the person's
     * oldest games against computers end as for any new one, so a rematch never takes them past
     * MAX_COMPUTER_GAMES.
     *
     * @param {{ code: string, playerId: string, now: number }} input  `playerId` is the computer player's
     * @returns {Promise<Readonly<import("../../data/roomAccessor.js").Room>>} the room after the answer
     */
    async acceptRematch({ code, playerId, now }) {
      const asked = await roomComponent.getRoom(code);
      const [person] = asked.seats.filter((seat) => seat.bot === undefined);
      return inTurn(person.playerId, async () => {
        const room = await roomComponent.requestRematch({ code, playerId, now });
        if (room.status === ROOM_STATUS.PLAYING) {
          await endOldestGames({ playerId: person.playerId, keep: code, now });
        }
        return room;
      });
    },
  });
}
