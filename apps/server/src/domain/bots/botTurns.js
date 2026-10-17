import { createHash } from "node:crypto";
import { BOT_CHARACTERS, ROOM_STATUS } from "@classicade/shared";
import { createSeededRng } from "@classicade/games";
import { assertDefined } from "../../utils/assert.js";
import { ForbiddenError } from "../../utils/errors.js";

/**
 * What computer players do in a room (CC-138, CC-225), as pure decisions on a stored room. The room component asks
 * it about every change it saves, and the bot driver asks it what to do next. Nothing here waits, stores or sends.
 *
 * A computer player decides only from what its own seat may see (`engine.viewFor`), with randomness seeded from the
 * game's seed, so the same turn always gets the same move, also after a restart.
 *
 * @typedef {import("../../data/roomAccessor.js").Room} Room
 *
 * @typedef {Object} StoredSeal          one sealed move, kept with the game (see seals.js)
 * @property {string} playerId          the computer player that sealed it
 * @property {number} sealedAt          how many log entries the game had when it was sealed
 * @property {string} text              the move as JSON text, the exact text that was hashed
 * @property {string} salt
 * @property {string} commitment
 * @property {boolean} revealed         whether players may see the move and the salt yet
 *
 * @typedef {{ kind: "none" }
 *   | { kind: "move", playerId: string, key: string }
 *   | { kind: "answer", playerId: string, move: unknown, key: string }
 *   | { kind: "rematch", playerId: string, key: string }} BotAction   what a computer player should do next. `key`
 *   names the moment, so the driver knows whether a planned action is still the right one
 *
 * @typedef {Object} FairnessView        what every viewer may see of the seals (CC-225)
 * @property {Array<{ playerId: string, commitment: string }>} locked    sealed moves not shown yet
 * @property {Array<{ playerId: string, commitment: string, text: string, salt: string }>} checks   shown seals,
 *   oldest first, each one checkable by hashing `text:salt`
 */

export const NO_ACTION = Object.freeze({ kind: "none" });

/** The room rules for a server that never seats a computer player: no room changes, no move is refused. */
export const NO_BOT_TURNS = Object.freeze({
  settle: (room) => room,
  checkMove: () => undefined,
  fairness: () => Object.freeze({ locked: [], checks: [] }),
});

const seedFor = (game, botId) =>
  createHash("sha256").update(`${game.seed}:${game.log.length}:${botId}`).digest().readUInt32BE(0);

/**
 * @param {{
 *   bots: ReturnType<typeof import("@classicade/games").createBotRegistry>,
 *   engines: ReturnType<typeof import("@classicade/games").createEngineRegistry>,
 *   sealMaker: ReturnType<typeof import("./seals.js").createSealMaker>,
 * }} deps
 */
export function createBotTurns({ bots, engines, sealMaker }) {
  assertDefined(bots, "bots");
  assertDefined(engines, "engines");
  assertDefined(sealMaker, "sealMaker");

  const botSeats = (room) => room.seats.filter((seat) => seat.bot !== undefined);
  const sealsOf = (room) => room.game?.seals ?? [];
  const openSeal = (room, playerId) =>
    sealsOf(room).find((seal) => seal.playerId === playerId && !seal.revealed);
  const playedSince = (room, seal) =>
    room.game.log
      .slice(seal.sealedAt)
      .some((entry) => entry.kind === "move" && entry.playerId === seal.playerId);
  const activeIn = (room) =>
    room.status === ROOM_STATUS.PLAYING ? engines.get(room.gameId).activePlayers(room.game.state) : [];

  function botLevelOf(room, seat) {
    const character = BOT_CHARACTERS.find((entry) => entry.id === seat.bot.character);
    return character.levels.find((level) => level.id === seat.bot.level).botLevel;
  }

  /** The move the computer player in `seat` chooses now, from its own view only. */
  function choose(room, seat) {
    const engine = engines.get(room.gameId);
    return bots.get(room.gameId).chooseMove({
      view: engine.viewFor(room.game.state, seat.playerId),
      botId: seat.playerId,
      rng: createSeededRng(seedFor(room.game, seat.playerId)),
      difficulty: botLevelOf(room, seat),
      history: [],
    });
  }

  /** Seals that may be shown now: the computer played the move and may act again, or the game is over. */
  function reveal(room, seals, active) {
    const over = room.status !== ROOM_STATUS.PLAYING;
    return seals.map((seal) =>
      !seal.revealed && (over || (active.includes(seal.playerId) && playedSince(room, seal)))
        ? { ...seal, revealed: true }
        : seal,
    );
  }

  /** A computer player that must act at the same time as someone else chooses now, and seals its choice. */
  function sealNew(room, seals, active) {
    const due = botSeats(room).filter(
      (seat) =>
        active.includes(seat.playerId) &&
        active.length > 1 &&
        !seals.some((seal) => seal.playerId === seat.playerId && !seal.revealed),
    );
    return due.map((seat) => {
      const sealedAt = room.game.log.length;
      const { text, salt, commitment } = sealMaker.seal({
        key: `${room.game.matchId}:${sealedAt}:${seat.playerId}`,
        text: JSON.stringify(choose(room, seat)),
      });
      return { playerId: seat.playerId, sealedAt, text, salt, commitment, revealed: false };
    });
  }

  return Object.freeze({
    /**
     * Runs on every room the room component is about to save. Shows the seals whose round is over, and seals the
     * choice of a computer player that must choose at the same time as a person. Answers the same room when
     * nothing changes.
     *
     * @param {Readonly<Room>} room
     * @returns {Readonly<Room>}
     */
    settle(room) {
      if (room.game === undefined || botSeats(room).length === 0) {
        return room;
      }
      const active = activeIn(room);
      const shown = reveal(room, sealsOf(room), active);
      const added = sealNew(room, shown, active);
      const changed = added.length > 0 || shown.some((seal, index) => seal !== sealsOf(room)[index]);
      return changed ? { ...room, game: { ...room.game, seals: [...shown, ...added] } } : room;
    },

    /**
     * Refuses a computer player's move that is not the one it sealed. People are never asked.
     *
     * @param {{ room: Readonly<Room>, playerId: string, move: unknown }} input
     * @throws {ForbiddenError}
     */
    checkMove({ room, playerId, move }) {
      const seal = openSeal(room, playerId);
      if (seal !== undefined && !playedSince(room, seal) && JSON.stringify(move) !== seal.text) {
        throw new ForbiddenError("A computer player must play the move it locked in");
      }
    },

    /**
     * What every viewer may see of the seals. Both lists are empty in a game without any.
     *
     * @param {Readonly<Room>} room
     * @returns {FairnessView}
     */
    fairness(room) {
      const seals = sealsOf(room);
      return {
        locked: seals
          .filter((seal) => !seal.revealed)
          .map(({ playerId, commitment }) => ({ playerId, commitment })),
        checks: seals
          .filter((seal) => seal.revealed)
          .map(({ playerId, commitment, text, salt }) => ({ playerId, commitment, text, salt })),
      };
    },

    /**
     * What a computer player in the room should do next: move when it is its turn, answer a question such as a
     * draw offer, or accept a rematch a person asked for. A computer player never asks for a rematch itself. The
     * move itself is chosen later, by `moveFor`, because a strong chess level takes a moment to think.
     *
     * @param {Readonly<Room>} room
     * @returns {Readonly<BotAction>}
     */
    nextAction(room) {
      const seats = botSeats(room);
      if (seats.length === 0 || room.game === undefined) {
        return NO_ACTION;
      }
      const { matchId, log } = room.game;
      if (room.status === ROOM_STATUS.FINISHED) {
        const { requestedBy, available } = room.rematch;
        const waiting = seats.find((seat) => !requestedBy.includes(seat.playerId));
        return available && requestedBy.length > 0 && waiting !== undefined
          ? { kind: "rematch", playerId: waiting.playerId, key: `${matchId}:rematch` }
          : NO_ACTION;
      }
      const active = activeIn(room);
      const engine = engines.get(room.gameId);
      for (const seat of seats) {
        const key = `${matchId}:${log.length}:${seat.playerId}`;
        if (active.includes(seat.playerId)) {
          return { kind: "move", playerId: seat.playerId, key };
        }
        const [answer] = bots
          .get(room.gameId)
          .answer({ view: engine.viewFor(room.game.state, seat.playerId), botId: seat.playerId });
        if (answer !== undefined) {
          return { kind: "answer", playerId: seat.playerId, move: answer, key };
        }
      }
      return NO_ACTION;
    },

    /**
     * The move a computer player makes on its turn: the one it sealed when it has one, otherwise its choice now.
     *
     * @param {Readonly<Room>} room
     * @param {string} playerId  a computer player whose turn it is
     */
    moveFor(room, playerId) {
      const seal = openSeal(room, playerId);
      return seal === undefined
        ? choose(
            room,
            botSeats(room).find((seat) => seat.playerId === playerId),
          )
        : JSON.parse(seal.text);
    },
  });
}
