import { randomInt } from "node:crypto";
import { GAME_STATUS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_STATUS } from "@classicade/shared";
import { createSeededRng } from "@classicade/games";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ConflictError, ForbiddenError, ValidationError } from "../../utils/errors.js";

/** Events the room component publishes for other parts of the system to react to (observer pattern). */
export const ROOM_EVENTS = Object.freeze({
  /** { code, reason } — a room was removed (empty, expired) */
  CLOSED: "room.closed",
  /** { room, outcome } — a game ended (played to the end or forfeited); consumed by matches/progression */
  GAME_FINISHED: "room.gameFinished",
});

/** How long rooms may sit idle before the sweeper closes them. */
export const ROOM_TTL_MS = Object.freeze({
  waiting: 30 * 60 * 1000,
  finished: 10 * 60 * 1000,
  abandoned: 5 * 60 * 1000, // every seat disconnected, any status
});

const MAX_CODE_ATTEMPTS = 10;

const randomRoomCode = () =>
  Array.from(
    { length: ROOM_CODE_LENGTH },
    () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
  ).join("");
const randomSeed = () => randomInt(2 ** 31);

/**
 * Room rules and lifecycle (waiting → playing → finished → closed), independent of transport and storage.
 * Every operation reads the room, produces a new room, and saves it; nothing is mutated in place.
 *
 * @param {{
 *   roomAccessor: ReturnType<typeof import("../../data/roomAccessor.js").createRoomAccessor>,
 *   engines: ReturnType<typeof import("@classicade/games").createEngineRegistry>,
 *   events: { emit: (event: string, payload: unknown) => void },
 *   generateCode?: () => string,
 *   generateSeed?: () => number,
 * }} deps  generators are injectable for deterministic tests
 */
export function createRoomComponent({
  roomAccessor,
  engines,
  events,
  generateCode = randomRoomCode,
  generateSeed = randomSeed,
}) {
  assertDefined(roomAccessor, "roomAccessor");
  assertDefined(engines, "engines");
  assertFunction(events?.emit, "events.emit");
  assertFunction(generateCode, "generateCode");
  assertFunction(generateSeed, "generateSeed");

  const engineFor = (room) => engines.get(room.gameId);
  const seatOf = (room, playerId) => room.seats.find((seat) => seat.playerId === playerId);
  const requireSeat = (room, playerId) => {
    const seat = seatOf(room, playerId);
    if (seat === undefined) {
      throw new ForbiddenError("You are not in this room");
    }
    return seat;
  };
  const withSeats = (room, seats, now) => ({ ...room, seats, lastActivityAt: now });
  const setConnected = (room, playerId, connected, now) =>
    withSeats(
      room,
      room.seats.map((seat) => (seat.playerId === playerId ? { ...seat, connected } : seat)),
      now,
    );

  function close(code, reason) {
    roomAccessor.remove(code);
    events.emit(ROOM_EVENTS.CLOSED, { code, reason });
  }

  function finish(room, outcome) {
    const finished = { ...room, status: ROOM_STATUS.FINISHED, result: outcome };
    events.emit(ROOM_EVENTS.GAME_FINISHED, { room: finished, outcome });
    return finished;
  }

  function start(room, now) {
    const engine = engineFor(room);
    const seed = generateSeed();
    const state = engine.init({
      players: room.seats.map((seat) => seat.playerId),
      options: room.options,
      rng: createSeededRng(seed),
    });
    return { ...room, status: ROOM_STATUS.PLAYING, game: { seed, state }, lastActivityAt: now };
  }

  /** Outcome of a forfeit: everyone except the leaver wins. */
  const forfeitOutcome = (room, leaverId) => ({
    status: GAME_STATUS.FINISHED,
    result: "win",
    winners: room.seats.map((seat) => seat.playerId).filter((id) => id !== leaverId),
    reason: "forfeit",
  });

  const component = {
    /**
     * Creates a room with the host seated. Unknown games and invalid options are rejected.
     *
     * @param {{ host: import("../../models/identity.js").Identity, gameId: string, options: unknown, now: number }} input
     */
    createRoom({ host, gameId, options, now }) {
      if (typeof gameId !== "string" || !engines.has(gameId)) {
        throw new ValidationError("That game is not available", { details: { field: "gameId" } });
      }
      const validated = engines.get(gameId).validateOptions(options ?? {});
      if (!validated.ok) {
        throw new ValidationError(validated.message, { details: { field: "options" } });
      }
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
        const code = generateCode();
        if (!roomAccessor.exists(code)) {
          return roomAccessor.create({
            code,
            gameId,
            options: validated.value,
            status: ROOM_STATUS.WAITING,
            hostId: host.id,
            seats: [{ playerId: host.id, displayName: host.displayName, connected: true }],
            createdAt: now,
            lastActivityAt: now,
          });
        }
      }
      throw new Error(`Could not find a free room code after ${MAX_CODE_ATTEMPTS} attempts`);
    },

    /**
     * Seats a player (starting the game once enough players have joined), or reconnects a seated player.
     *
     * @param {{ code: string, player: import("../../models/identity.js").Identity, now: number }} input
     */
    joinRoom({ code, player, now }) {
      const room = roomAccessor.getByCode(code);
      if (seatOf(room, player.id) !== undefined) {
        return roomAccessor.save(setConnected(room, player.id, true, now));
      }
      if (room.status !== ROOM_STATUS.WAITING) {
        throw new ConflictError("This game has already started");
      }
      const engine = engineFor(room);
      if (room.seats.length >= engine.players.max) {
        throw new ConflictError("Room is full");
      }
      const seated = withSeats(
        room,
        [...room.seats, { playerId: player.id, displayName: player.displayName, connected: true }],
        now,
      );
      const next = seated.seats.length === engine.players.max ? start(seated, now) : seated;
      return roomAccessor.save(next);
    },

    /**
     * Applies a move through the game engine. Rule violations become ValidationErrors carrying the reason.
     *
     * @param {{ code: string, playerId: string, move: unknown, now: number }} input
     */
    makeMove({ code, playerId, move, now }) {
      const room = roomAccessor.getByCode(code);
      requireSeat(room, playerId);
      if (room.status !== ROOM_STATUS.PLAYING) {
        throw new ConflictError(
          room.status === ROOM_STATUS.WAITING ? "The game has not started yet" : "The game is over",
        );
      }
      const engine = engineFor(room);
      const ctx = { now };
      const validated = engine.validateMove(room.game.state, playerId, move, ctx);
      if (!validated.ok) {
        throw new ValidationError(validated.message, { details: { reason: validated.reason } });
      }
      const state = engine.applyMove(room.game.state, playerId, validated.value, ctx);
      const played = { ...room, game: { ...room.game, state }, lastActivityAt: now };
      const outcome = engine.getOutcome(state);
      return roomAccessor.save(outcome.status === GAME_STATUS.FINISHED ? finish(played, outcome) : played);
    },

    /**
     * Leaves a room. Leaving a game in progress forfeits it; an empty room is closed; the host role passes on.
     *
     * @param {{ code: string, playerId: string, now: number }} input
     * @returns {{ closed: true } | { closed: false, room: Readonly<import("../../data/roomAccessor.js").Room> }}
     */
    leaveRoom({ code, playerId, now }) {
      const room = roomAccessor.getByCode(code);
      requireSeat(room, playerId);
      if (room.status === ROOM_STATUS.PLAYING) {
        const forfeited = finish(setConnected(room, playerId, false, now), forfeitOutcome(room, playerId));
        return { closed: false, room: roomAccessor.save(forfeited) };
      }
      const seats = room.seats.filter((seat) => seat.playerId !== playerId);
      if (seats.length === 0) {
        close(code, "empty");
        return { closed: true };
      }
      const hostId = room.hostId === playerId ? seats[0].playerId : room.hostId;
      return { closed: false, room: roomAccessor.save({ ...withSeats(room, seats, now), hostId }) };
    },

    /** Marks a player's seat as disconnected (they keep it and can rejoin). */
    playerDisconnected({ code, playerId, now }) {
      const room = roomAccessor.getByCode(code);
      requireSeat(room, playerId);
      return roomAccessor.save(setConnected(room, playerId, false, now));
    },

    /**
     * Closes rooms that have been idle too long. Called periodically by the composition root.
     *
     * @param {{ now: number }} input
     * @returns {string[]} codes of closed rooms
     */
    sweepExpired({ now }) {
      const closed = [];
      for (const room of roomAccessor.listAll()) {
        const idle = now - room.lastActivityAt;
        const abandoned = room.seats.every((seat) => !seat.connected) && idle >= ROOM_TTL_MS.abandoned;
        const expired =
          (room.status === ROOM_STATUS.WAITING && idle >= ROOM_TTL_MS.waiting) ||
          (room.status === ROOM_STATUS.FINISHED && idle >= ROOM_TTL_MS.finished);
        if (abandoned || expired) {
          close(room.code, abandoned ? "abandoned" : "expired");
          closed.push(room.code);
        }
      }
      return closed;
    },

    /** @param {string} code */
    getRoom: (code) => roomAccessor.getByCode(code),

    /**
     * What one viewer may see. Seated players get their own game view; anyone else sees the spectator view.
     *
     * @param {Readonly<import("../../data/roomAccessor.js").Room>} room
     * @param {string} viewerId
     */
    viewFor(room, viewerId) {
      const engine = engineFor(room);
      const seated = seatOf(room, viewerId) !== undefined;
      const view = {
        code: room.code,
        gameId: room.gameId,
        status: room.status,
        hostId: room.hostId,
        players: { min: engine.players.min, max: engine.players.max },
        seats: room.seats.map(({ playerId, displayName, connected }) => ({
          playerId,
          displayName,
          connected,
        })),
        you: seated ? viewerId : "",
      };
      if (room.game === undefined) {
        return view;
      }
      const outcome = room.status === ROOM_STATUS.FINISHED ? room.result : engine.getOutcome(room.game.state);
      return {
        ...view,
        game: {
          view: engine.viewFor(room.game.state, seated ? viewerId : "spectator"),
          activePlayers: room.status === ROOM_STATUS.PLAYING ? engine.activePlayers(room.game.state) : [],
          outcome,
        },
      };
    },
  };

  return Object.freeze(component);
}
