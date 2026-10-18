import { randomInt, randomUUID } from "node:crypto";
import {
  GAME_STATUS,
  ROOM_CLOSE_REASONS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_LIMIT_REASONS,
  ROOM_STATUS,
} from "@classicade/shared";
import { createSeededRng, renamePlayer } from "@classicade/games";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import {
  ConcurrentChangeError,
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  ServerBusyError,
  ValidationError,
} from "../../utils/errors.js";
import { NO_BOT_TURNS } from "../bots/botTurns.js";
import { lifetimeOf, roomLifetimes } from "./roomLifetimes.js";
import { roomLimits } from "./roomLimits.js";

/** Events the room component publishes for other parts of the system to react to. */
export const ROOM_EVENTS = Object.freeze({
  /** `{ room }`: a room was saved with a change, whoever made it. The bot driver plans its next action from it */
  CHANGED: "room.changed",
  /** `{ code, reason }`: a room was closed, `reason` is a ROOM_CLOSE_REASONS value */
  CLOSED: "room.closed",
  /** `{ room, outcome }`: a game ended (played to the end or forfeited), recorded by matches and progression */
  GAME_FINISHED: "room.gameFinished",
  /** `{ room }`: a room changed without a player asking (a clock ran out), so clients need the new view */
  UPDATED: "room.updated",
});

const MAX_CODE_ATTEMPTS = 10;
// Two requests for the same room can read the same version, and only one of them can save it. The other reads
// again and decides again on the new state. A handful of attempts is plenty: a room has at most a few players.
const MAX_WRITE_ATTEMPTS = 5;
// Rooms whose seats move to the account when a guest signs in (CC-083, CC-097): every room still open.
const SEATS_FOLLOW_IDENTITY = new Set([ROOM_STATUS.WAITING, ROOM_STATUS.PLAYING, ROOM_STATUS.FINISHED]);
const NO_REMATCH = Object.freeze({ requestedBy: Object.freeze([]), available: false, declinedBy: "" });
const CLOSED = Object.freeze({ closed: true });

const randomRoomCode = () =>
  Array.from(
    { length: ROOM_CODE_LENGTH },
    () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
  ).join("");
const randomSeed = () => randomInt(2 ** 31);

/** What a decision returns when the room should close instead of being saved. */
const closeAs = (reason) => Object.freeze({ closeAs: reason });
const isClosing = (decision) => Object.hasOwn(decision, "closeAs");

/** A room that is not there any more, or whose record was forgotten, is simply skipped by bulk work. */
const isGone = (err) => err instanceof NotFoundError || err instanceof GoneError;

/**
 * Room rules and lifecycle (waiting, playing, finished, closed), independent of transport and storage.
 * Every change reads the room, decides the new room and saves it as of the version it read. When someone else
 * saved first, the change is decided again on what they saved, so no update is ever lost.
 *
 * Rooms are kept in storage, not in this process, so they outlive a restart. How long each kind of room lives
 * is in roomLifetimes.js. A room whose time is up is closed the moment anyone touches it, and the regular sweep
 * closes the rest.
 *
 * @param {{
 *   roomAccessor: ReturnType<typeof import("../../data/roomAccessor.js").createRoomAccessor>,
 *   engines: ReturnType<typeof import("@classicade/games").createEngineRegistry>,
 *   events: { emit: (event: string, payload: unknown) => void },
 *   lifetimes?: Readonly<import("./roomLifetimes.js").RoomLifetimes>,
 *   limits?: Readonly<import("./roomLimits.js").RoomLimits>,
 *   generateCode?: () => string,
 *   generateSeed?: () => number,
 *   generateMatchId?: () => string,
 *   botTurns?: Pick<ReturnType<typeof import("../bots/botTurns.js").createBotTurns>, "settle" | "checkMove" | "fairness">,
 *   keepFinishedGame?: (game: { room: Readonly<import("../../data/roomAccessor.js").Room>, outcome: object }) => Promise<unknown>,
 * }} deps  lifetimes, limits and generators can be given so tests are short and exact. `botTurns` are the rules for
 *   computer players (CC-138, CC-225). Without them no room ever seats one. `keepFinishedGame` stores a finished
 *   game for the match pipeline (CC-111). It runs before every change to a finished room, so a game is never
 *   replaced by a rematch or closed with its room before it is safe. Without it nothing is kept
 */
export function createRoomComponent({
  roomAccessor,
  engines,
  events,
  lifetimes = roomLifetimes(),
  limits = roomLimits(),
  generateCode = randomRoomCode,
  generateSeed = randomSeed,
  generateMatchId = randomUUID,
  botTurns = NO_BOT_TURNS,
  keepFinishedGame = async () => {},
}) {
  assertDefined(roomAccessor, "roomAccessor");
  assertDefined(engines, "engines");
  assertDefined(lifetimes, "lifetimes");
  assertDefined(limits, "limits");
  assertFunction(events?.emit, "events.emit");
  assertFunction(generateCode, "generateCode");
  assertFunction(generateSeed, "generateSeed");
  assertFunction(generateMatchId, "generateMatchId");
  assertFunction(keepFinishedGame, "keepFinishedGame");

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

  /**
   * Adds what storage needs to find the room again at the right moment: when its game's next deadline falls
   * (a chess flag) and when its lifetime ends.
   */
  function stamp(room) {
    const engine = engineFor(room);
    const timed = room.status === ROOM_STATUS.PLAYING && engine.deadline !== undefined;
    return {
      ...room,
      dueAt: timed ? engine.deadline(room.game.state) : 0,
      expiresAt: lifetimeOf(room, lifetimes).endsAt,
    };
  }

  /**
   * Reads a room. A room that closed recently answers GoneError with the reason, so the player hears why it is
   * gone instead of being told it never existed.
   */
  async function read(code) {
    try {
      return await roomAccessor.getByCode(code);
    } catch (err) {
      if (!(err instanceof NotFoundError) || !(await roomAccessor.wasClosed(code))) {
        throw err;
      }
      const { reason, gameId, closedAt } = await roomAccessor.getClosed(code);
      throw new GoneError("This room has closed", { cause: err, details: { reason, gameId, closedAt } });
    }
  }

  /**
   * A finished room holds its game until the match pipeline has it (CC-111). Before the room changes or closes,
   * the game is kept. Keeping a game twice changes nothing, and when keeping fails the change fails with it, so the
   * game stays in its room for the next try.
   */
  async function keepGameOf(room) {
    if (room.status === ROOM_STATUS.FINISHED) {
      await keepFinishedGame({ room, outcome: room.result });
    }
  }

  async function close(room, reason, now) {
    await keepGameOf(room);
    await roomAccessor.close({ room, reason, closedAt: now });
    events.emit(ROOM_EVENTS.CLOSED, { code: room.code, reason });
  }

  /** Closes the room if its lifetime is over. Answers whether it did. */
  async function closeIfOver(room, now) {
    const { endsAt, reason } = lifetimeOf(room, lifetimes);
    if (now < endsAt) {
      return false;
    }
    await close(room, reason, now);
    return true;
  }

  /** Reads a room that is still alive at `now`. One whose time is up is closed here and answers GoneError. */
  async function load(code, now) {
    const room = await read(code);
    try {
      if (await closeIfOver(room, now)) {
        return read(code);
      }
    } catch (err) {
      // The sweep or another player closed it at this same moment. Reading it again says why it closed, instead
      // of telling this player the room never existed (CC-204).
      if (err instanceof NotFoundError) {
        return read(code);
      }
      throw err;
    }
    return room;
  }

  /**
   * The one way rooms change. `decide` gets the current room and answers the next room, the same room for
   * no change, or `closeAs(reason)`. It may throw to refuse. It must not have side effects, because it runs
   * again whenever someone else saved the room first.
   *
   * @returns {Promise<{ closed: true } | { closed: false, changed: boolean, room: Readonly<import("../../data/roomAccessor.js").Room> }>}
   */
  async function change({ code, now, decide }) {
    for (let attempt = 1; ; attempt++) {
      try {
        const room = await load(code, now);
        const decided = decide(room);
        if (isClosing(decided)) {
          await close(room, decided.closeAs, now);
          return CLOSED;
        }
        // A computer player that must choose at the same moment as a person seals its choice in the same save
        // that starts the round, so nobody ever sees the round without the lock (CC-225).
        const decision = decided === room ? room : botTurns.settle(decided);
        if (decision === room) {
          return { closed: false, changed: false, room };
        }
        await keepGameOf(room);
        const saved = await roomAccessor.save({ room: stamp(decision), previous: room });
        if (room.status === ROOM_STATUS.PLAYING && saved.status === ROOM_STATUS.FINISHED) {
          events.emit(ROOM_EVENTS.GAME_FINISHED, { room: saved, outcome: saved.result });
        }
        events.emit(ROOM_EVENTS.CHANGED, { room: saved });
        return { closed: false, changed: true, room: saved };
      } catch (err) {
        if (!(err instanceof ConcurrentChangeError) || attempt === MAX_WRITE_ATTEMPTS) {
          throw err;
        }
      }
    }
  }

  const changedRoom = async (input) => (await change(input)).room;

  /** Games finished in this room and wins per player, across rematches (CC-037). */
  const nextSeries = (series, outcome) => ({
    games: (series?.games ?? 0) + 1,
    wins: Object.fromEntries(
      [...new Set([...Object.keys(series?.wins ?? {}), ...outcome.winners])].map((id) => [
        id,
        (series?.wins?.[id] ?? 0) + (outcome.winners.includes(id) ? 1 : 0),
      ]),
    ),
  });

  const finish = (room, outcome, now) => ({
    ...room,
    status: ROOM_STATUS.FINISHED,
    result: outcome,
    finishedAt: now,
    series: nextSeries(room.series, outcome),
    // Someone who forfeited has left the game, so there is nobody to play again with.
    rematch: { requestedBy: [], available: outcome.reason !== "forfeit", declinedBy: "" },
  });

  /**
   * A waiting room starts its game once every seat is taken and every seated player is there. A host who went away
   * after opening the room is never put into a game they cannot see (CC-112). The player who joined waits, and
   * the game starts the moment the host is back.
   */
  const readyToStart = (room) =>
    room.seats.length === engineFor(room).players.max && room.seats.every((seat) => seat.connected);
  const startWhenReady = (room, now) => (readyToStart(room) ? start(room, now) : room);

  function start(room, now) {
    const engine = engineFor(room);
    const seed = generateSeed();
    const state = engine.init({
      players: room.seats.map((seat) => seat.playerId),
      options: room.options,
      rng: createSeededRng(seed),
    });
    return {
      ...room,
      status: ROOM_STATUS.PLAYING,
      game: { matchId: generateMatchId(), seed, startedAt: now, state, log: [] },
      lastActivityAt: now,
    };
  }

  /** Outcome of a forfeit: everyone except the leaver wins. */
  const forfeitOutcome = (room, leaverId) => ({
    status: GAME_STATUS.FINISHED,
    result: "win",
    winners: room.seats.map((seat) => seat.playerId).filter((id) => id !== leaverId),
    reason: "forfeit",
  });

  /** A player leaves: a game in progress is forfeited, an empty room closes, the host role passes on. */
  function leaving(room, playerId, now) {
    requireSeat(room, playerId);
    if (room.status === ROOM_STATUS.PLAYING) {
      const left = setConnected(room, playerId, false, now);
      const logged = {
        ...left,
        game: { ...left.game, log: [...left.game.log, { kind: "forfeit", playerId, at: now }] },
      };
      return finish(logged, forfeitOutcome(room, playerId), now);
    }
    const seats = room.seats.filter((seat) => seat.playerId !== playerId);
    // A computer player never plays alone, so a room with nobody else left is empty (CC-138).
    if (seats.every((seat) => seat.bot !== undefined)) {
      return closeAs(ROOM_CLOSE_REASONS.EMPTY);
    }
    const hostId = room.hostId === playerId ? seats[0].playerId : room.hostId;
    const left = { ...withSeats(room, seats, now), hostId };
    if (room.status !== ROOM_STATUS.FINISHED) {
      return left;
    }
    // A player left a finished game: no rematch any more, and nobody waits for one. Their seat is gone, so the
    // room keeps their name to tell the player still there who left (CC-162).
    return { ...left, rematch: { ...NO_REMATCH, leftName: seatOf(room, playerId).displayName } };
  }

  /** Runs `work` for each room, skipping rooms that closed in the meantime. Answers what `work` answered. */
  async function eachRoom(rooms, work) {
    const results = [];
    for (const room of rooms) {
      try {
        results.push(await work(room));
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    }
    return results;
  }

  /**
   * Refuses a new room when the host already has as many waiting rooms as one player may have, or when the server
   * is full (CC-107). A waiting room whose time is up counts as closed, even before the sweep removes it. Two rooms
   * created at the very same moment can both pass, which only lets a player go one room over.
   */
  async function checkRoomLimits(host, network, now) {
    const waiting = (await roomAccessor.listBySeat(host.id)).filter(
      (room) => room.status === ROOM_STATUS.WAITING && now < lifetimeOf(room, lifetimes).endsAt,
    );
    if (waiting.length >= limits.waitingRoomsPerPlayer) {
      throw new ConflictError(
        `You already have ${limits.waitingRoomsPerPlayer} rooms waiting; close one first`,
        {
          details: { reason: ROOM_LIMIT_REASONS.WAITING_ROOMS, limit: limits.waitingRoomsPerPlayer },
        },
      );
    }
    // Guests cost nothing to make, so a cap per player alone would let a few networks fill the server (CC-107).
    if ((await roomAccessor.countByNetwork(network)) >= limits.openRoomsPerAddress) {
      throw new ConflictError("Too many rooms are open from your network. Try again later.", {
        details: { reason: ROOM_LIMIT_REASONS.NETWORK_ROOMS, limit: limits.openRoomsPerAddress },
      });
    }
    if ((await roomAccessor.countOpen()) >= limits.openRoomsMax) {
      throw new ServerBusyError("The server is busy, try again in a minute", {
        details: { reason: ROOM_LIMIT_REASONS.SERVER_FULL },
      });
    }
  }

  const component = {
    /**
     * Creates a room with the host seated. Unknown games and invalid options are rejected. A code is never one
     * still in use, nor one that closed recently, so an old link never leads into a stranger's new room.
     *
     * @param {{
     *   host: import("../../models/identity.js").Identity,
     *   network: string,
     *   gameId: string,
     *   options: unknown,
     *   now: number,
     * }} input  `network` names the host's network address without being it (see the gateway), so the rooms
     *   opened from one network can be counted
     * @throws {ConflictError} when the host already has as many waiting rooms as allowed, or their network as many
     *   open rooms (see roomLimits.js)
     * @throws {ServerBusyError} when the server holds as many rooms as it can
     */
    async createRoom({ host, network, gameId, options, now }) {
      if (typeof network !== "string" || network === "") {
        throw new TypeError("createRoom needs the network the host connects from");
      }
      if (typeof gameId !== "string" || !engines.has(gameId)) {
        throw new ValidationError("That game is not available", { details: { field: "gameId" } });
      }
      const validated = engines.get(gameId).validateOptions(options ?? {});
      if (!validated.ok) {
        throw new ValidationError(validated.message, { details: { field: "options" } });
      }
      await checkRoomLimits(host, network, now);
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
        const code = generateCode();
        if ((await roomAccessor.exists(code)) || (await roomAccessor.wasClosed(code))) {
          continue;
        }
        const room = {
          code,
          gameId,
          options: validated.value,
          status: ROOM_STATUS.WAITING,
          hostId: host.id,
          network,
          seats: [{ playerId: host.id, displayName: host.displayName, connected: true }],
          createdAt: now,
          lastActivityAt: now,
        };
        try {
          return await roomAccessor.create(stamp(room));
        } catch (err) {
          // Another room took the same code a moment ago: try the next one.
          if (!(err instanceof ConflictError)) throw err;
        }
      }
      throw new Error(`Could not find a free room code after ${MAX_CODE_ATTEMPTS} attempts`);
    },

    /**
     * Seats a player, or reconnects a seated player. The game starts once every seat is taken and every seated
     * player is connected, so it may start when the last player who was away comes back. A computer player
     * (CC-138) keeps its `bot` label on the seat, so every view shows it as one.
     *
     * @param {{ code: string, player: import("../../models/identity.js").Identity | import("../../models/botIdentity.js").BotIdentity, now: number }} input
     * @throws {GoneError} when the room has closed, with the reason in `details`
     */
    joinRoom: ({ code, player, now }) =>
      changedRoom({
        code,
        now,
        decide(room) {
          const waiting = room.status === ROOM_STATUS.WAITING;
          if (seatOf(room, player.id) !== undefined) {
            const back = setConnected(room, player.id, true, now);
            return waiting ? startWhenReady(back, now) : back;
          }
          if (!waiting) {
            throw new ConflictError("This game has already started");
          }
          // Every seat is taken, and the game waits for a player who is away.
          if (room.seats.length === engineFor(room).players.max) {
            throw new ConflictError("This room is full");
          }
          const seated = withSeats(
            room,
            [
              ...room.seats,
              {
                playerId: player.id,
                displayName: player.displayName,
                connected: true,
                ...("bot" in player && { bot: player.bot }),
              },
            ],
            now,
          );
          return startWhenReady(seated, now);
        },
      }),

    /**
     * Applies a move through the game engine. Rule violations become ValidationErrors carrying the reason.
     *
     * @param {{ code: string, playerId: string, move: unknown, now: number }} input
     */
    makeMove: ({ code, playerId, move, now }) =>
      changedRoom({
        code,
        now,
        decide(room) {
          requireSeat(room, playerId);
          if (room.status !== ROOM_STATUS.PLAYING) {
            throw new ConflictError(
              room.status === ROOM_STATUS.WAITING ? "The game has not started yet" : "The game is over",
            );
          }
          botTurns.checkMove({ room, playerId, move });
          const engine = engineFor(room);
          const ctx = { now };
          const validated = engine.validateMove(room.game.state, playerId, move, ctx);
          if (!validated.ok) {
            throw new ValidationError(validated.message, { details: { reason: validated.reason } });
          }
          const state = engine.applyMove(room.game.state, playerId, validated.value, ctx);
          const entry = { kind: "move", playerId, move: validated.value, at: now };
          const played = {
            ...room,
            game: { ...room.game, state, log: [...room.game.log, entry] },
            lastActivityAt: now,
          };
          const outcome = engine.getOutcome(state);
          return outcome.status === GAME_STATUS.FINISHED ? finish(played, outcome, now) : played;
        },
      }),

    /**
     * Leaves a room. Leaving a game in progress forfeits it, an empty room is closed, and the host role passes on.
     * With `waitingOnly` it leaves only a room that still waits for players, and changes nothing once the game has
     * started: the room page sends that when it closes, and a game that started a moment before must not be
     * forfeited by it (CC-112).
     *
     * @param {{ code: string, playerId: string, now: number, waitingOnly?: boolean }} input
     * @returns {Promise<{ closed: true } | { closed: false, room: Readonly<import("../../data/roomAccessor.js").Room> }>}
     */
    async leaveRoom({ code, playerId, now, waitingOnly = false }) {
      const decide = (room) =>
        waitingOnly && room.status !== ROOM_STATUS.WAITING ? room : leaving(room, playerId, now);
      const result = await change({ code, now, decide });
      return result.closed ? CLOSED : { closed: false, room: result.room };
    },

    /**
     * Toggles a seated player's rematch request in a finished game (CC-037). Once every seated player has
     * asked, a new game starts in the same room: new match id and seed, same options, seats reversed so the
     * first move (X, White) alternates. Asking does not keep the room open longer: the rematch window ends
     * at the time the players were shown.
     *
     * @param {{ code: string, playerId: string, now: number }} input
     * @returns {Promise<Readonly<import("../../data/roomAccessor.js").Room>>}
     * @throws {ForbiddenError} for someone without a seat
     * @throws {ConflictError} when the game is not finished or a rematch is no longer possible
     * @throws {GoneError} when the rematch window has ended and the room closed
     */
    requestRematch: ({ code, playerId, now }) =>
      changedRoom({
        code,
        now,
        decide(room) {
          requireSeat(room, playerId);
          if (room.status !== ROOM_STATUS.FINISHED) {
            throw new ConflictError("A rematch is only possible after the game is over");
          }
          if (!room.rematch.available) {
            throw new ConflictError("Your opponent left, so a rematch is no longer possible");
          }
          const { requestedBy } = room.rematch;
          const requested = requestedBy.includes(playerId)
            ? requestedBy.filter((id) => id !== playerId)
            : [...requestedBy, playerId];
          if (!room.seats.every((seat) => requested.includes(seat.playerId))) {
            return {
              ...room,
              // Any new request or withdrawal starts over, so an old "no" is not shown again.
              rematch: { ...room.rematch, requestedBy: requested, declinedBy: "" },
              lastActivityAt: now,
            };
          }
          const { result, rematch, game, finishedAt, ...rest } = room;
          return start({ ...rest, seats: [...room.seats].reverse() }, now);
        },
      }),

    /**
     * A seated player says no to the rematch their opponent asked for (CC-104). The request is dropped and the room
     * remembers who declined, so the asker is told. A rematch stays possible: either player may ask again until the
     * rematch window ends.
     *
     * @param {{ code: string, playerId: string, now: number }} input
     * @returns {Promise<Readonly<import("../../data/roomAccessor.js").Room>>}
     * @throws {ForbiddenError} for someone without a seat
     * @throws {ConflictError} when the game is not finished, a rematch is no longer possible, or nobody else asked
     * @throws {GoneError} when the rematch window has ended and the room closed
     */
    declineRematch: ({ code, playerId, now }) =>
      changedRoom({
        code,
        now,
        decide(room) {
          requireSeat(room, playerId);
          if (room.status !== ROOM_STATUS.FINISHED || !room.rematch.available) {
            throw new ConflictError("There is no rematch to decline");
          }
          if (!room.rematch.requestedBy.some((id) => id !== playerId)) {
            throw new ConflictError("Nobody asked you for a rematch");
          }
          return {
            ...room,
            rematch: { ...room.rematch, requestedBy: [], declinedBy: playerId },
            lastActivityAt: now,
          };
        },
      }),

    /**
     * Marks a player's seat as disconnected. They keep it and can rejoin.
     *
     * @param {{ code: string, playerId: string, now: number }} input
     */
    playerDisconnected: ({ code, playerId, now }) =>
      changedRoom({
        code,
        now,
        decide(room) {
          requireSeat(room, playerId);
          return setConnected(room, playerId, false, now);
        },
      }),

    /**
     * After a restart nobody is connected yet, whatever storage says: the old process could not record the
     * disconnects when it stopped or crashed. Each player is shown as connected again when their browser
     * rejoins, which it does by itself. The last activity time stays, so an away room is not kept any longer.
     * A computer player lives in the server and is back with it, so it stays connected.
     *
     * @param {{ now: number }} input
     * @returns {Promise<string[]>} codes of rooms that changed
     */
    async markEveryoneAway({ now }) {
      const away = (seat) => seat.connected && seat.bot === undefined;
      const results = await eachRoom(await roomAccessor.listAll(), (stored) =>
        change({
          code: stored.code,
          now,
          decide: (room) =>
            room.seats.some(away)
              ? {
                  ...room,
                  seats: room.seats.map((seat) => (away(seat) ? { ...seat, connected: false } : seat)),
                }
              : room,
        }),
      );
      return results.filter((result) => !result.closed && result.changed).map((result) => result.room.code);
    },

    /**
     * Applies time-based events whose deadline has passed (a chess flag falling while nobody moves), for any
     * engine that exposes `deadline` and `expire`. Called every second, and once at startup for flags that fell
     * while the server was down.
     *
     * @param {{ now: number }} input
     * @returns {Promise<string[]>} codes of rooms that changed
     */
    async expireDue({ now }) {
      const results = await eachRoom(await roomAccessor.listDue(now), (stored) =>
        change({
          code: stored.code,
          now,
          decide(room) {
            const engine = engineFor(room);
            if (room.status !== ROOM_STATUS.PLAYING || engine.deadline === undefined) {
              return room;
            }
            const due = engine.deadline(room.game.state);
            if (due === 0 || now < due) {
              return room;
            }
            const state = engine.expire(room.game.state, { now });
            const log = [...room.game.log, { kind: "expire", at: now }];
            const expired = { ...room, game: { ...room.game, state, log }, lastActivityAt: now };
            const outcome = engine.getOutcome(state);
            return outcome.status === GAME_STATUS.FINISHED ? finish(expired, outcome, now) : expired;
          },
        }),
      );
      const changed = results.filter((result) => !result.closed && result.changed);
      changed.forEach(({ room }) => events.emit(ROOM_EVENTS.UPDATED, { room }));
      return changed.map(({ room }) => room.code);
    },

    /**
     * Closes rooms whose lifetime is over, and forgets closed rooms after a day. Called periodically.
     *
     * @param {{ now: number }} input
     * @returns {Promise<string[]>} codes of closed rooms
     */
    async sweepExpired({ now }) {
      const results = await eachRoom(await roomAccessor.listExpired(now), async (room) => {
        try {
          return (await closeIfOver(room, now)) ? room.code : "";
        } catch (err) {
          // It changed since it was listed, so its lifetime may have moved. The next sweep looks again.
          if (err instanceof ConcurrentChangeError) return "";
          throw err;
        }
      });
      await roomAccessor.forgetClosedBefore(now - lifetimes.closedRecordMs);
      return results.filter((code) => code !== "");
    },

    /**
     * The player signed out: they give up their seats in rooms that have not started (CC-085), so nobody else
     * on that browser (a new guest after pressing Back) lands in a game against them. Running games keep the
     * seat.
     *
     * @param {{ playerId: string, now: number }} input
     * @returns {Promise<Array<Readonly<import("../../data/roomAccessor.js").Room>>>} rooms that changed and still exist
     */
    async giveUpWaitingSeats({ playerId, now }) {
      const results = await eachRoom(await roomAccessor.listBySeat(playerId), (stored) =>
        change({
          code: stored.code,
          now,
          decide: (room) =>
            room.status === ROOM_STATUS.WAITING && seatOf(room, playerId) !== undefined
              ? leaving(room, playerId, now)
              : room,
        }),
      );
      return results.filter((result) => !result.closed && result.changed).map((result) => result.room);
    },

    /**
     * A guest just signed in: every seat they hold in a waiting, running or finished room becomes their account's
     * (CC-083), so they come back to their own game instead of meeting their old guest seat. After signing up from
     * a won game's "Save your progress" card (CC-097) they come back to its result and the rematch offer, not to
     * "Can't join this room". The seat counts as disconnected until the account's socket rejoins. If the account
     * already sits in the same waiting room, the guest seat is simply given up. A running or finished game the
     * account already plays in is left alone.
     *
     * @param {{ from: string, to: import("../../models/identity.js").Identity, now: number }} input
     * @returns {Promise<Array<Readonly<import("../../data/roomAccessor.js").Room>>>} rooms that changed
     */
    async transferPlayer({ from, to, now }) {
      const results = await eachRoom(await roomAccessor.listBySeat(from), (stored) =>
        change({
          code: stored.code,
          now,
          decide(room) {
            if (!SEATS_FOLLOW_IDENTITY.has(room.status) || seatOf(room, from) === undefined) return room;
            if (seatOf(room, to.id) !== undefined) {
              // The account's own seat stays, so the room never empties here.
              return room.status === ROOM_STATUS.WAITING ? leaving(room, from, now) : room;
            }
            const seats = room.seats.map((seat) =>
              seat.playerId === from
                ? { playerId: to.id, displayName: to.displayName, connected: false }
                : seat,
            );
            return {
              ...withSeats(room, seats, now),
              hostId: room.hostId === from ? to.id : room.hostId,
              ...(room.series && { series: renamePlayer(room.series, from, to.id) }),
              ...(room.result && { result: renamePlayer(room.result, from, to.id) }),
              ...(room.rematch && { rematch: renamePlayer(room.rematch, from, to.id) }),
              ...(room.game && {
                game: {
                  ...room.game,
                  state: renamePlayer(room.game.state, from, to.id),
                  log: renamePlayer(room.game.log, from, to.id),
                },
              }),
            };
          },
        }),
      );
      return results.filter((result) => result.changed).map((result) => result.room);
    },

    /** @param {string} code */
    getRoom: (code) => read(code),

    /**
     * How many open rooms there are of each status, for the regular gauge in the logs (CC-107).
     *
     * @returns {Promise<Readonly<Record<"waiting" | "playing" | "finished", number>>>}
     */
    countRooms: () => roomAccessor.countByStatus(),

    /**
     * The game of every stored room that is finished, as `room.gameFinished` announced it. The match pipeline adds
     * them again at startup and now and then (CC-111): a game whose announcement was lost to a crash or a database
     * blip still reaches it while its room waits for a rematch. Rooms whose time is up are listed too, because a
     * game is never lost for being late.
     *
     * @returns {Promise<Array<{ room: Readonly<import("../../data/roomAccessor.js").Room>, outcome: object }>>}
     */
    async listFinishedGames() {
      const rooms = await roomAccessor.listAll();
      return rooms
        .filter((room) => room.status === ROOM_STATUS.FINISHED)
        .map((room) => ({ room, outcome: room.result }));
    },

    /**
     * What one viewer may see. Seated players get their own game view, anyone else sees the spectator view.
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
        seats: room.seats.map(({ playerId, displayName, connected, bot }) => ({
          playerId,
          displayName,
          connected,
          // A computer player is labelled in every view, so nobody takes it for a person (ADR-025).
          ...(bot !== undefined && { bot: { character: bot.character, level: bot.level } }),
        })),
        you: seated ? viewerId : "",
      };
      if (room.game === undefined) {
        return view;
      }
      const finished = room.status === ROOM_STATUS.FINISHED;
      const outcome = finished ? room.result : engine.getOutcome(room.game.state);
      return {
        ...view,
        ...(finished && {
          rematch: {
            requestedBy: [...room.rematch.requestedBy],
            available: room.rematch.available,
            until: lifetimeOf(room, lifetimes).endsAt,
            // Rooms stored before declines existed (CC-104) have none: nobody declined in them.
            declinedBy: room.rematch.declinedBy ?? "",
            // Only after a player left the finished game: who it was (CC-162).
            ...(room.rematch.leftName !== undefined && { leftName: room.rematch.leftName }),
          },
        }),
        ...(room.series && { series: { games: room.series.games, wins: { ...room.series.wins } } }),
        ...(room.game.seals?.length > 0 && { fairness: botTurns.fairness(room) }),
        game: {
          // Which match this is, so the result can show the progress update the server sends for it (CC-235).
          matchId: room.game.matchId,
          view: engine.viewFor(room.game.state, seated ? viewerId : "spectator"),
          activePlayers: room.status === ROOM_STATUS.PLAYING ? engine.activePlayers(room.game.state) : [],
          outcome,
        },
      };
    },
  };

  return Object.freeze(component);
}
