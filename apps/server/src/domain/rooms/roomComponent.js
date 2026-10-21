import { randomInt, randomUUID } from "node:crypto";
import {
  GAME_STATUS,
  PRESENCE,
  REQUEST_ANSWERS,
  REQUEST_STATES,
  ROOM_CLOSE_REASONS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_END_REASONS,
  ROOM_LIMIT_REASONS,
  ROOM_REQUEST_TYPES,
  ROOM_STATUS,
  isAvatarId,
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
import { isDeletedPlayerId } from "../../models/deletedPlayer.js";
import { renameIdShapes } from "../identity/idShapes.js";
import { NO_BOT_TURNS } from "../bots/botTurns.js";
import { lifetimeOf, roomLifetimes } from "./roomLifetimes.js";
import { roomLimits } from "./roomLimits.js";
import {
  graceUntil,
  nextDue,
  presenceOf,
  presenceSince,
  releaseAt,
  turnLimit,
  withPresence,
  withTurnCredit,
} from "./roomPresence.js";
import {
  addRequest,
  askAgainAt,
  declineByMoving,
  endRequest,
  openRequest,
  requestsLeft,
  requireAnswerer,
  ruleFor,
  sameRequests,
  settleRequests,
} from "./roomRequests.js";

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
  /**
   * `{ room, playerIds }`: a request between the players opened or ended (CC-159). The players in `playerIds` hear
   * about it on whatever page they are (CC-207): those seated before or after the change, so a player whose seat
   * was given up is told too. When a room with requests closes, `room` is the room as it was, with none left.
   */
  REQUESTS_CHANGED: "room.requestsChanged",
});

const MAX_CODE_ATTEMPTS = 10;
// Two requests for the same room can read the same version, and only one of them can save it. The other reads
// again and decides again on the new state. A handful of attempts is plenty: a room has at most a few players.
const MAX_WRITE_ATTEMPTS = 5;
// Rooms whose seats move to the account when a guest signs in (CC-083, CC-097): every room still open.
const SEATS_FOLLOW_IDENTITY = new Set([ROOM_STATUS.WAITING, ROOM_STATUS.PLAYING, ROOM_STATUS.FINISHED]);
const NO_REMATCH = Object.freeze({ available: false });
const CLOSED = Object.freeze({ closed: true });
const ABORTED = Object.freeze({
  status: GAME_STATUS.FINISHED,
  result: ROOM_END_REASONS.ABORTED,
  winners: Object.freeze([]),
  reason: ROOM_END_REASONS.ABORTED,
});
const isAborted = (room) => room.result?.result === ROOM_END_REASONS.ABORTED;
// Without a block store nobody is blocked. Tests that are not about blocks build rooms without one.
const NOBODY = Object.freeze(new Set());
const NO_RELATIONS = Object.freeze({ blocked: NOBODY, blockedBy: NOBODY });
const NOBODY_BLOCKED = Object.freeze({
  blockedWith: async () => NOBODY,
  relationsOf: async () => NO_RELATIONS,
});
// Without a profile store nobody has picked an avatar. Tests that are not about avatars build rooms without one.
const NO_AVATARS = Object.freeze({ avatarOf: async () => undefined });
/** The avatar a person picked, kept on their seat so every view can show it (CC-034). None is kept when there is none. */
const avatarField = (avatar) => (avatar === undefined ? {} : { avatar });
// A blocked pair is refused a seat with exactly the answer a full room gets, so the refusal never tells a player
// that they were blocked (ADR-053).
const FULL = "This room is full";
/** The people seated in a room before or after a change, each once. A computer player hears nothing. */
const playersOf = (before, after) => [
  ...new Set(
    [...before.seats, ...after.seats].filter((seat) => seat.bot === undefined).map((seat) => seat.playerId),
  ),
];

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
 *   blocks?: {
 *     blockedWith: (query: { playerId: string }) => Promise<ReadonlySet<string>>,
 *     relationsOf: (query: { playerId: string }) => Promise<Readonly<{ blocked: ReadonlySet<string>, blockedBy: ReadonlySet<string> }>>,
 *   },
 *   seatIds: Pick<ReturnType<typeof import("./seatIds.js").createSeatIds>, "seatIdOf">,
 *   avatars?: { avatarOf: (query: { playerId: string }) => Promise<string | undefined> },
 * }} deps  lifetimes, limits and generators can be given so tests are short and exact. `botTurns` are the rules for
 *   computer players (CC-138, CC-225). Without them no room ever seats one. `keepFinishedGame` stores a finished
 *   game for the match pipeline (CC-111). It runs before every change to a finished room, so a game is never
 *   replaced by a rematch or closed with its room before it is safe. Without it nothing is kept. `blocks` answers
 *   the players on either side of a block with someone (CC-044): they are never seated together or rematched.
 *   `seatIds` names the players in every view (CC-253). It has no default, so a view can never fall back to
 *   showing player ids. `avatars` answers the avatar a person picked (CC-034), read when they sit down. Without it
 *   nobody has one
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
  blocks = NOBODY_BLOCKED,
  seatIds,
  avatars = NO_AVATARS,
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
  assertFunction(blocks?.blockedWith, "blocks.blockedWith");
  assertFunction(blocks?.relationsOf, "blocks.relationsOf");
  assertFunction(seatIds?.seatIdOf, "seatIds.seatIdOf");
  assertFunction(avatars?.avatarOf, "avatars.avatarOf");

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
  // A player due to move who comes back from offline gets that time back for the turn (see `turnLimit`).
  const present = (room, playerId, presence, now) =>
    withTurnCredit(room, withPresence(room, { playerId, presence, now }), {
      playerId,
      now,
      engine: engineFor(room),
      lifetimes,
    });
  const rulesOf = (room) => (type) => ruleFor({ type, engine: engineFor(room), lifetimes });
  const settled = (room, now) => settleRequests(room, { now, rules: rulesOf(room), lifetimes });
  /** Who `playerId` blocked and who blocked them, read only for a rematch: no other request needs it. */
  const relationsForRematch = (playerId, type) =>
    type === ROOM_REQUEST_TYPES.REMATCH ? blocks.relationsOf({ playerId }) : NO_RELATIONS;
  /**
   * What saying yes to a rematch does between a blocked pair (CC-044, ADR-053). It never starts a game, and the
   * blocked player sees only what any opponent could do. The blocker's yes is a no, so the player who asked sees a
   * decline. The blocked player's yes finds the question taken back, as if the blocker had withdrawn it. Answers
   * undefined for a pair with no block, whose yes is a yes.
   */
  const blockedAnswer = (relations, request) => {
    if (relations.blocked.has(request.from)) return REQUEST_STATES.DECLINED;
    if (relations.blockedBy.has(request.from)) return REQUEST_STATES.WITHDRAWN;
    return undefined;
  };

  /**
   * Every player a room names anywhere: the seats and the host, the players of its game as its engine lists them
   * (the engine is the one that knows, a player who left is still in the game), and anyone the result, the series,
   * the requests or the game's log names.
   */
  const playersNamedIn = (room) =>
    new Set([
      room.hostId,
      ...room.seats.map((seat) => seat.playerId),
      ...(room.game === undefined ? [] : engineFor(room).playersOf(room.game.state)),
      ...(room.game?.log ?? []).flatMap((entry) =>
        [entry.playerId, entry.from, ...(entry.playerIds ?? [])].filter((id) => id !== undefined),
      ),
      ...(room.result?.winners ?? []),
      ...Object.keys(room.series?.wins ?? {}),
      ...(room.requests ?? []).flatMap((request) => [request.from, request.to]),
    ]);
  /**
   * `value` with every player of the room named by their seat id instead of their player id, wherever it names
   * them, as a value or as a key (CC-253). Player ids are unique strings, so nothing else is changed. Last, anything
   * still shaped like a player id is named by its seat id too, so an id that nobody listed is never sent as it is.
   */
  const withSeatIds = (room, value) => {
    const seatIdOf = (playerId) => seatIds.seatIdOf(room, playerId);
    return renameIdShapes(
      [...playersNamedIn(room)].reduce(
        (renamed, playerId) => renamePlayer(renamed, playerId, seatIdOf(playerId)),
        value,
      ),
      seatIdOf,
    );
  };
  /** The viewer's own seat id, or "" for a viewer without a seat. */
  const yourSeatId = (room, viewerId) =>
    seatOf(room, viewerId) === undefined ? "" : seatIds.seatIdOf(room, viewerId);

  /**
   * Adds what storage needs to find the room again at the right moment: when something next happens in it by
   * itself (a chess flag, an idle limit, a request expiring, a seat given up) and when its lifetime ends.
   */
  function stamp(room) {
    return {
      ...room,
      dueAt: nextDue(room, { engine: engineFor(room), lifetimes }),
      expiresAt: lifetimeOf(room, lifetimes).endsAt,
    };
  }

  /** Tells the rest of the system about rooms that changed without a player asking. */
  function announce(rooms) {
    rooms.forEach((room) => events.emit(ROOM_EVENTS.UPDATED, { room }));
    return rooms;
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
   * game stays in its room for the next try. An aborted game is not a match (CC-036), so there is nothing to keep.
   */
  async function keepGameOf(room) {
    if (room.status === ROOM_STATUS.FINISHED && !isAborted(room)) {
      await keepFinishedGame({ room, outcome: room.result });
    }
  }

  async function close(room, reason, now) {
    await keepGameOf(room);
    await roomAccessor.close({ room, reason, closedAt: now });
    events.emit(ROOM_EVENTS.CLOSED, { code: room.code, reason });
    // A player on another page is not in the room's channel, so only this tells them its requests have gone.
    if ((room.requests ?? []).length > 0) {
      events.emit(ROOM_EVENTS.REQUESTS_CHANGED, {
        room: { ...room, requests: [] },
        playerIds: playersOf(room, room),
      });
    }
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
   * again whenever someone else saved the room first. The requests of the next room are brought up to `now`
   * before it is saved, so none outlives its time or the game it belongs to.
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
        const next = settled(decision, now);
        if (next === room) {
          return { closed: false, changed: false, room };
        }
        await keepGameOf(room);
        const saved = await roomAccessor.save({ room: stamp(next), previous: room });
        // An aborted game is not a match, so nothing records it (CC-036).
        if (
          room.status === ROOM_STATUS.PLAYING &&
          saved.status === ROOM_STATUS.FINISHED &&
          !isAborted(saved)
        ) {
          events.emit(ROOM_EVENTS.GAME_FINISHED, { room: saved, outcome: saved.result });
        }
        events.emit(ROOM_EVENTS.CHANGED, { room: saved });
        if (!sameRequests(room.requests, saved.requests)) {
          // A player whose seat this change gave up still has to hear that the requests to them have gone.
          events.emit(ROOM_EVENTS.REQUESTS_CHANGED, { room: saved, playerIds: playersOf(room, saved) });
        }
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
    rematch: { available: outcome.reason !== ROOM_END_REASONS.FORFEIT },
  });

  /** Ends a game where someone never made a first move. It counts for nothing, and a rematch stays possible. */
  const abort = (room, now) => ({
    ...room,
    status: ROOM_STATUS.FINISHED,
    result: ABORTED,
    finishedAt: now,
    rematch: { available: true },
    lastActivityAt: now,
  });

  /** Which game of the room this is, from 1. Rooms stored before games were numbered count their series. */
  const gameNumberOf = (room) =>
    room.game.number ??
    (room.series?.games ?? 0) - (room.status === ROOM_STATUS.FINISHED && !isAborted(room) ? 1 : 0) + 1;

  /**
   * A waiting room starts its game once every seat is taken and every seated player is on the room page. A host
   * who went away after opening the room, or is on another page of the site, is never put into a game they cannot
   * see (CC-112, CC-207). The player who joined waits, and the game starts the moment the host is back.
   */
  const readyToStart = (room) =>
    room.seats.length === engineFor(room).players.max &&
    room.seats.every((seat) => presenceOf(seat) === PRESENCE.HERE);
  const startWhenReady = (room, now) => (readyToStart(room) ? start(room, now, { number: 1 }) : room);

  /**
   * Starts the room's next game. `named` holds the `starter` for a rematch, and is empty for game 1, where the
   * engine draws who moves first from the seed. The starter is kept beside the seed, so the game replays exactly
   * (CC-091).
   */
  function start(room, now, { number, named = {} }) {
    const engine = engineFor(room);
    const seed = generateSeed();
    const state = engine.init({
      players: room.seats.map((seat) => seat.playerId),
      options: room.options,
      rng: createSeededRng(seed),
      ...named,
    });
    return {
      ...room,
      status: ROOM_STATUS.PLAYING,
      game: { matchId: generateMatchId(), number, seed, ...named, startedAt: now, state, log: [] },
      lastActivityAt: now,
    };
  }

  /**
   * Who moves first in the rematch of a finished room: the player seated after the one who started the game
   * before, so with two players the first move alternates. It is read from the finished game's state, so it holds
   * after a restart. Games where everyone moves at once (Rock Paper Scissors) name nobody (CC-091).
   *
   * @returns {{ starter?: string }}
   */
  function nextStarter(room) {
    const engine = engineFor(room);
    if (engine.starterOf === undefined) {
      return {};
    }
    const players = room.seats.map((seat) => seat.playerId);
    return { starter: players[(players.indexOf(engine.starterOf(room.game.state)) + 1) % players.length] };
  }

  /** Outcome of a forfeit: everyone except the leaver wins. */
  const forfeitOutcome = (room, leaverId) => ({
    status: GAME_STATUS.FINISHED,
    result: "win",
    winners: room.seats.map((seat) => seat.playerId).filter((id) => id !== leaverId),
    reason: ROOM_END_REASONS.FORFEIT,
  });

  /** A game the player leaves, or is gone from for too long, ends with them losing by forfeit. */
  const forfeited = (room, playerId, now) =>
    finish(
      { ...room, game: { ...room.game, log: [...room.game.log, { kind: "forfeit", playerId, at: now }] } },
      forfeitOutcome(room, playerId),
      now,
    );

  /** A player leaves: a game in progress is forfeited, an empty room closes, the host role passes on. */
  function leaving(room, playerId, now) {
    requireSeat(room, playerId);
    if (room.status === ROOM_STATUS.PLAYING) {
      return forfeited(present(room, playerId, PRESENCE.AWAY, now), playerId, now);
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

  /**
   * What accepting a request does. A rematch starts the next game in this room: new match id and seed, same
   * options, seats reversed, and the first move (X, White) to the player who did not start the game before
   * (CC-091). A request of the game goes to its engine, and is logged so the match replays (a chess draw offer ends
   * the game by agreement).
   */
  function accepting(room, request, now) {
    const accepted = endRequest(room, { request, state: REQUEST_STATES.ACCEPTED, now });
    if (request.type === ROOM_REQUEST_TYPES.REMATCH) {
      const { result, rematch, game, finishedAt, ...rest } = accepted;
      return start({ ...rest, seats: [...room.seats].reverse() }, now, {
        number: gameNumberOf(room) + 1,
        named: nextStarter(room),
      });
    }
    const engine = engineFor(room);
    const { type, from, to } = request;
    const state = engine.acceptRequest(room.game.state, { type, from, to }, { now });
    const entry = { kind: "agree", type, from, playerId: to, at: now };
    const agreed = {
      ...accepted,
      game: { ...accepted.game, state, log: [...accepted.game.log, entry] },
      lastActivityAt: now,
    };
    const outcome = engine.getOutcome(state);
    return outcome.status === GAME_STATUS.FINISHED ? finish(agreed, outcome, now) : agreed;
  }

  /** A game whose clock ran out by itself (a chess flag falling while nobody moves), for engines with time hooks. */
  function applyDeadline(room, now) {
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
  }

  /**
   * A game where the players due to move took too long (CC-036). If one of them never made a first move, the game
   * is aborted and nothing is recorded. Otherwise everyone due loses as idle, and if that is everyone, it is a draw.
   */
  function applyIdleLimit(room, now) {
    const limit = turnLimit(room, { engine: engineFor(room), lifetimes });
    if (limit.endsAt === 0 || now < limit.endsAt) {
      return room;
    }
    if (limit.firstMove) {
      return abort(room, now);
    }
    const winners = room.seats.map((seat) => seat.playerId).filter((id) => !limit.due.includes(id));
    const outcome =
      winners.length === 0
        ? { status: GAME_STATUS.FINISHED, result: "draw", winners, reason: ROOM_END_REASONS.IDLE }
        : { status: GAME_STATUS.FINISHED, result: "win", winners, reason: ROOM_END_REASONS.IDLE };
    const entry = { kind: "idle", playerIds: limit.due, at: now };
    return finish({ ...room, game: { ...room.game, log: [...room.game.log, entry] } }, outcome, now);
  }

  /**
   * Players who stayed away from a finished room for too long give up their seat (CC-207), one after another,
   * as if they had left. The room closes once nobody is left.
   */
  function releaseSeats(room, now) {
    const gone = room.seats.filter((seat) => {
      const at = releaseAt(room, seat, lifetimes);
      return at > 0 && now >= at;
    });
    return gone.reduce(
      (current, seat) => (isClosing(current) ? current : leaving(current, seat.playerId, now)),
      room,
    );
  }

  /**
   * The room with every trace of player `from` given to `to`: the seat (disconnected until `to` joins), the host
   * role, the series, the result, the rematch and the game.
   */
  function handedOver(room, from, to, now) {
    const seats = room.seats.map((seat) =>
      seat.playerId === from
        ? {
            playerId: to.id,
            displayName: to.displayName,
            // A guest who signed in keeps the avatar on their seat. A deleted player's stand-in keeps nothing.
            ...(isDeletedPlayerId(to.id) ? {} : avatarField(seat.avatar)),
            connected: false,
          }
        : seat,
    );
    return {
      ...withSeats(room, seats, now),
      hostId: room.hostId === from ? to.id : room.hostId,
      ...(room.series && { series: renamePlayer(room.series, from, to.id) }),
      ...(room.result && { result: renamePlayer(room.result, from, to.id) }),
      ...(room.rematch && { rematch: renamePlayer(room.rematch, from, to.id) }),
      ...(room.requests && { requests: renamePlayer(room.requests, from, to.id) }),
      ...(room.game && {
        game: {
          ...room.game,
          state: renamePlayer(room.game.state, from, to.id),
          log: renamePlayer(room.game.log, from, to.id),
          ...(room.game.starter !== undefined && { starter: renamePlayer(room.game.starter, from, to.id) }),
        },
      }),
    };
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
  async function checkRoomLimits(host, networks, now) {
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
    if ((await roomAccessor.countByNetworks(networks)) >= limits.openRoomsPerAddress) {
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

  /**
   * In every room where the player sits with presence `from`, sets it to `to`, and tells the rest of the system
   * about each room that changed. Answers those rooms.
   */
  async function changePresence({ playerId, now, from, to }) {
    const results = await eachRoom(await roomAccessor.listBySeat(playerId), (stored) =>
      change({
        code: stored.code,
        now,
        decide(room) {
          const seat = seatOf(room, playerId);
          return seat !== undefined && presenceOf(seat) === from ? present(room, playerId, to, now) : room;
        },
      }),
    );
    return announce(
      results.filter((result) => !result.closed && result.changed).map((result) => result.room),
    );
  }

  /** A new room needs the network of the player making it, and the earlier names of that network (CC-249). */
  function checkNetworks(network, earlierNetworks) {
    if (typeof network !== "string" || network === "") {
      throw new TypeError("a new room needs the network the player connects from");
    }
    if (
      !Array.isArray(earlierNetworks) ||
      !earlierNetworks.every((name) => typeof name === "string" && name !== "")
    ) {
      throw new TypeError("a new room needs earlier network names as a list of names");
    }
  }

  /** The game's options as its engine accepts them. An unknown game or invalid options are refused. */
  function validOptions(gameId, options) {
    if (typeof gameId !== "string" || !engines.has(gameId)) {
      throw new ValidationError("That game is not available", { details: { field: "gameId" } });
    }
    const validated = engines.get(gameId).validateOptions(options ?? {});
    if (!validated.ok) {
      throw new ValidationError(validated.message, { details: { field: "options" } });
    }
    return validated.value;
  }

  /**
   * Stores a new room under a code that is not in use and did not close recently, so an old link never leads into a
   * stranger's new room.
   */
  async function createWithFreshCode(fields) {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = generateCode();
      if ((await roomAccessor.exists(code)) || (await roomAccessor.wasClosed(code))) {
        continue;
      }
      try {
        return await roomAccessor.create(stamp({ code, ...fields }));
      } catch (err) {
        // Another room took the same code a moment ago: try the next one.
        if (!(err instanceof ConflictError)) throw err;
      }
    }
    throw new Error(`Could not find a free room code after ${MAX_CODE_ATTEMPTS} attempts`);
  }

  const component = {
    /**
     * Creates a room with the host seated. Unknown games and invalid options are rejected. A code is never one
     * still in use, nor one that closed recently, so an old link never leads into a stranger's new room.
     *
     * @param {{
     *   host: import("../../models/identity.js").Identity,
     *   network: string,
     *   earlierNetworks?: ReadonlyArray<string>,
     *   gameId: string,
     *   options: unknown,
     *   now: number,
     *   quickMatch?: boolean,
     * }} input  `network` names the host's network address without being it (see the gateway), so the rooms
     *   opened from one network can be counted. `earlierNetworks` are the names the same address had under
     *   earlier keys that are still in use, so rooms opened before the name changed still count (CC-249). Without
     *   them only rooms with the same `network` count. `quickMatch` marks a room quick match made (CC-051), so
     *   whoever sits in it with the host met as strangers (ADR-051.7, `coPlayers`)
     * @throws {ConflictError} when the host already has as many waiting rooms as allowed, or their network as many
     *   open rooms (see roomLimits.js)
     * @throws {ServerBusyError} when the server holds as many rooms as it can
     */
    async createRoom({ host, network, earlierNetworks = [], gameId, options, now, quickMatch = false }) {
      checkNetworks(network, earlierNetworks);
      const value = validOptions(gameId, options);
      await checkRoomLimits(host, [network, ...earlierNetworks], now);
      const hostAvatar = avatarField(await avatars.avatarOf({ playerId: host.id }));
      return createWithFreshCode({
        gameId,
        options: value,
        status: ROOM_STATUS.WAITING,
        hostId: host.id,
        network,
        ...(quickMatch && { quickMatch: true }),
        seats: [
          {
            playerId: host.id,
            displayName: host.displayName,
            ...hostAvatar,
            connected: true,
            away: false,
            since: now,
          },
        ],
        createdAt: now,
        lastActivityAt: now,
      });
    },

    /**
     * A game's options as its engine accepts them, the same check a new room makes. A challenge (CC-139) stores
     * them so the room made from it later gets exactly these.
     *
     * @param {{ gameId: string, options: unknown }} input
     * @returns {Readonly<object>}
     * @throws {ValidationError} for an unknown game or invalid options
     */
    checkOptions: ({ gameId, options }) => validOptions(gameId, options),

    /**
     * Makes the room of a challenge someone took (CC-139, ADR-069), with both players seated and the game waiting
     * for both to open its page. The challenger is the host and sits first. They are offline until their browser is
     * known to be on the site, which the service layer then records as away. The player who took it is away until
     * their room page opens a moment later. The room counts against the limits of the player who took it and of
     * their network, because they are the one making it now. The challenge has already checked blocks.
     *
     * @param {{
     *   challenger: Readonly<{ id: string, displayName: string }>,
     *   accepter: import("../../models/identity.js").Identity,
     *   network: string,
     *   earlierNetworks?: ReadonlyArray<string>,
     *   gameId: string,
     *   options: unknown,
     *   now: number,
     * }} input  `network` and `earlierNetworks` as in `createRoom`, for the player who took the challenge
     * @throws {ConflictError} or {ServerBusyError} as `createRoom` does
     */
    async createChallengeRoom({ challenger, accepter, network, earlierNetworks = [], gameId, options, now }) {
      checkNetworks(network, earlierNetworks);
      const value = validOptions(gameId, options);
      await checkRoomLimits(accepter, [network, ...earlierNetworks], now);
      const seat = async (player, away) => ({
        playerId: player.id,
        displayName: player.displayName,
        ...avatarField(await avatars.avatarOf({ playerId: player.id })),
        connected: false,
        away,
        since: now,
      });
      return createWithFreshCode({
        gameId,
        options: value,
        status: ROOM_STATUS.WAITING,
        hostId: challenger.id,
        network,
        seats: [await seat(challenger, false), await seat(accepter, true)],
        createdAt: now,
        lastActivityAt: now,
      });
    },

    /**
     * Seats a player, or reconnects a seated player. The game starts once every seat is taken and every seated
     * player is connected, so it may start when the last player who was away comes back. A computer player
     * (CC-138) keeps its `bot` label on the seat, so every view shows it as one.
     *
     * A player is never seated with someone on either side of a block with them (CC-044). They are told the room
     * is full, as they would be if it were.
     *
     * @param {{ code: string, player: import("../../models/identity.js").Identity | import("../../models/botIdentity.js").BotIdentity, now: number }} input
     * @throws {GoneError} when the room has closed, with the reason in `details`
     */
    joinRoom: async ({ code, player, now }) => {
      const blocked = await blocks.blockedWith({ playerId: player.id });
      // A computer character is drawn from its own art, never from a profile.
      const avatar = "bot" in player ? {} : avatarField(await avatars.avatarOf({ playerId: player.id }));
      return changedRoom({
        code,
        now,
        decide(room) {
          const waiting = room.status === ROOM_STATUS.WAITING;
          if (seatOf(room, player.id) !== undefined) {
            const back = { ...present(room, player.id, PRESENCE.HERE, now), lastActivityAt: now };
            return waiting ? startWhenReady(back, now) : back;
          }
          if (!waiting) {
            throw new ConflictError("This game has already started");
          }
          // Every seat is taken, and the game waits for a player who is away. Or someone here is blocked with them.
          if (
            room.seats.length === engineFor(room).players.max ||
            room.seats.some((seat) => blocked.has(seat.playerId))
          ) {
            throw new ConflictError(FULL);
          }
          const seated = withSeats(
            room,
            [
              ...room.seats,
              {
                playerId: player.id,
                displayName: player.displayName,
                ...avatar,
                connected: true,
                away: false,
                since: now,
                ...("bot" in player && { bot: player.bot }),
              },
            ],
            now,
          );
          return startWhenReady(seated, now);
        },
      });
    },

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
          // Moving instead of answering says no to what the opponent asked during the game (ADR-019).
          const answered = declineByMoving(room, { playerId, now });
          const played = {
            ...answered,
            game: { ...answered.game, state, log: [...answered.game.log, entry] },
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
     * A seated player asks the other something (CC-159): a rematch after a finished game, or what the game adds
     * during play, such as a draw offer. Asking for what the other player already asked you accepts it, so two
     * players pressing Rematch start the next game. Asking does not keep the room open longer: the rematch window
     * ends at the time the players were shown.
     *
     * @param {{ code: string, playerId: string, type: string, now: number }} input
     * @returns {Promise<Readonly<import("../../data/roomAccessor.js").Room>>}
     * @throws {ForbiddenError} for someone without a seat
     * @throws {ValidationError} for a kind of request this game does not have
     * @throws {ConflictError} at the wrong moment, while their own request is open, during the cooldown after
     *   the last one, once the limit is used up, or when a rematch is no longer possible. Between a blocked pair
     *   (CC-044) asking back never starts a game: the other's request ends the way `blockedAnswer` says, and this
     *   one is asked as if that had happened first
     * @throws {GoneError} when the room closed
     */
    askRequest: async ({ code, playerId, type, now }) => {
      const relations = await relationsForRematch(playerId, type);
      return changedRoom({
        code,
        now,
        decide(stored) {
          requireSeat(stored, playerId);
          let room = settled(stored, now);
          const theirs = openRequest(room, type);
          if (theirs !== undefined && theirs.to === playerId) {
            const ended = blockedAnswer(relations, theirs);
            if (ended === undefined) {
              return accepting(room, theirs, now);
            }
            room = endRequest(room, { request: theirs, state: ended, now });
          }
          if (
            type === ROOM_REQUEST_TYPES.REMATCH &&
            room.status === ROOM_STATUS.FINISHED &&
            !room.rematch.available
          ) {
            throw new ConflictError("Your opponent left, so a rematch is no longer possible");
          }
          const rule = rulesOf(room)(type);
          return { ...addRequest(room, { playerId, type, now, rule, lifetimes }), lastActivityAt: now };
        },
      });
    },

    /**
     * Answers an open request (CC-159): the player asked accepts or declines it, the player who asked withdraws
     * it. A rematch stays possible after a "no": either player may ask again after the cooldown, until the
     * rematch window ends.
     *
     * @param {{ code: string, playerId: string, type: string, answer: string, now: number }} input  `answer` is
     *   a REQUEST_ANSWERS value
     * @returns {Promise<Readonly<import("../../data/roomAccessor.js").Room>>}
     * @throws {ForbiddenError} for someone without a seat, or an answer that is not theirs to give
     * Between a blocked pair (CC-044) accepting a rematch never starts a game: it ends the request the way
     * `blockedAnswer` says, so the blocked player sees a decline or a withdrawal, as anyone might give them.
     *
     * @throws {ConflictError} when no such request is open any more
     * @throws {GoneError} when the room closed
     */
    answerRequest: async ({ code, playerId, type, answer, now }) => {
      const relations =
        answer === REQUEST_ANSWERS.ACCEPT ? await relationsForRematch(playerId, type) : NO_RELATIONS;
      return changedRoom({
        code,
        now,
        decide(stored) {
          requireSeat(stored, playerId);
          const room = settled(stored, now);
          const request = openRequest(room, type);
          if (request === undefined) {
            throw new ConflictError("That request is no longer open");
          }
          requireAnswerer({ request, playerId, byAsker: answer === REQUEST_ANSWERS.WITHDRAW });
          const blockedEnd =
            answer === REQUEST_ANSWERS.ACCEPT ? blockedAnswer(relations, request) : undefined;
          if (answer === REQUEST_ANSWERS.ACCEPT && blockedEnd === undefined) {
            return accepting(room, request, now);
          }
          const state =
            blockedEnd ??
            (answer === REQUEST_ANSWERS.DECLINE ? REQUEST_STATES.DECLINED : REQUEST_STATES.WITHDRAWN);
          return { ...endRequest(room, { request, state, now }), lastActivityAt: now };
        },
      });
    },

    /**
     * Marks a player's seat as offline: they lost their connection. They keep the seat and can rejoin.
     *
     * @param {{ code: string, playerId: string, now: number }} input
     */
    playerDisconnected: ({ code, playerId, now }) =>
      changedRoom({
        code,
        now,
        decide(room) {
          requireSeat(room, playerId);
          return present(room, playerId, PRESENCE.OFFLINE, now);
        },
      }),

    /**
     * The player left the room's page for another page of the site (CC-207). They keep the seat, and the opponent
     * sees them as away at once. Requests still reach them on the page they are on.
     *
     * @param {{ code: string, playerId: string, now: number }} input
     */
    playerAway: ({ code, playerId, now }) =>
      changedRoom({
        code,
        now,
        decide(room) {
          requireSeat(room, playerId);
          return present(room, playerId, PRESENCE.AWAY, now);
        },
      }),

    /**
     * The player connected to the site again without opening a room: in every room where they were offline they
     * are now away. Opening a room's page makes them here in it.
     *
     * @param {{ playerId: string, now: number }} input
     * @returns {Promise<Array<Readonly<import("../../data/roomAccessor.js").Room>>>} rooms that changed
     */
    playerOnline: ({ playerId, now }) =>
      changePresence({ playerId, now, from: PRESENCE.OFFLINE, to: PRESENCE.AWAY }),

    /**
     * The player's last connection to the site closed: in every room where they were away they are now offline.
     *
     * @param {{ playerId: string, now: number }} input
     * @returns {Promise<Array<Readonly<import("../../data/roomAccessor.js").Room>>>} rooms that changed
     */
    playerOffline: ({ playerId, now }) =>
      changePresence({ playerId, now, from: PRESENCE.AWAY, to: PRESENCE.OFFLINE }),

    /**
     * Claims the win of a game whose opponent has been offline for longer than the grace period (CC-036). The
     * opponent loses by forfeit, as if they had left.
     *
     * @param {{ code: string, playerId: string, now: number }} input
     * @returns {Promise<Readonly<import("../../data/roomAccessor.js").Room>>}
     * @throws {ForbiddenError} for someone without a seat
     * @throws {ConflictError} when the game is not on, or no opponent is past the grace period
     */
    claimWin: ({ code, playerId, now }) =>
      changedRoom({
        code,
        now,
        decide(room) {
          requireSeat(room, playerId);
          if (room.status !== ROOM_STATUS.PLAYING) {
            throw new ConflictError("The game is not on");
          }
          const gone = room.seats.find((seat) => {
            const until = graceUntil(room, seat, lifetimes);
            return seat.playerId !== playerId && until > 0 && now >= until;
          });
          if (gone === undefined) {
            throw new ConflictError("Your opponent can still come back");
          }
          return forfeited(room, gone.playerId, now);
        },
      }),

    /**
     * Every room where the player has a seat. Their requests are sent to a tab that connects, so a question reaches
     * it on any page, and a question that ended while the tab was offline goes away there (CC-207).
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<ReadonlyArray<Readonly<import("../../data/roomAccessor.js").Room>>>}
     */
    seatedRooms: ({ playerId }) => roomAccessor.listBySeat(playerId),

    /**
     * What one player of a room is told about its requests on any page of the site (CC-207): the requests, the
     * names to put in the question, and which seat is theirs. Players are named by seat id (CC-253).
     *
     * @param {Readonly<import("../../data/roomAccessor.js").Room>} room
     * @param {string} viewerId
     */
    requestsView: (room, viewerId) => ({
      code: room.code,
      gameId: room.gameId,
      you: yourSeatId(room, viewerId),
      names: Object.fromEntries(
        room.seats.map((seat) => [seatIds.seatIdOf(room, seat.playerId), seat.displayName]),
      ),
      requests: withSeatIds(
        room,
        (room.requests ?? []).map((request) => ({ ...request })),
      ),
    }),

    /**
     * After a restart nobody is connected yet, whatever storage says: the old process could not record the
     * disconnects when it stopped or crashed. Each player is shown as offline until their browser connects again,
     * which it does by itself. The last activity time stays, so an away room is not kept any longer. A computer
     * player lives in the server and is back with it, so it stays connected. Every game in progress resumes now:
     * nobody could move while the server was down, so the idle limit of the current turn starts again (see
     * `turnLimit`). A chess clock is the game's own, and keeps the time it stored (CC-036, PR #67 review).
     *
     * @param {{ now: number }} input
     * @returns {Promise<string[]>} codes of rooms that changed
     */
    async markEveryoneAway({ now }) {
      const away = (seat) => seat.bot === undefined && presenceOf(seat) !== PRESENCE.OFFLINE;
      const results = await eachRoom(await roomAccessor.listAll(), (stored) =>
        change({
          code: stored.code,
          now,
          decide(room) {
            const playing = room.status === ROOM_STATUS.PLAYING;
            if (!playing && !room.seats.some(away)) {
              return room;
            }
            return {
              ...room,
              seats: room.seats.map((seat) =>
                away(seat) ? { ...seat, connected: false, away: false, since: now } : seat,
              ),
              ...(playing && { game: { ...room.game, resumedAt: now } }),
            };
          },
        }),
      );
      return results.filter((result) => !result.closed && result.changed).map((result) => result.room.code);
    },

    /**
     * Applies everything due by time in rooms whose moment has come: a chess flag falling while nobody moves, an
     * idle limit (CC-036), an open request expiring (CC-159), and seats of a finished room given up by players
     * who stayed away (CC-207). Called every second, and once at startup for what fell due while the server was
     * down.
     *
     * @param {{ now: number }} input
     * @returns {Promise<string[]>} codes of rooms that changed and are still open
     */
    async expireDue({ now }) {
      const results = await eachRoom(await roomAccessor.listDue(now), (stored) =>
        change({
          code: stored.code,
          now,
          decide(room) {
            const timed = applyDeadline(room, now);
            const played = timed.status === ROOM_STATUS.PLAYING ? applyIdleLimit(timed, now) : timed;
            return played.status === ROOM_STATUS.FINISHED ? releaseSeats(played, now) : played;
          },
        }),
      );
      const changed = results.filter((result) => !result.closed && result.changed);
      announce(changed.map(({ room }) => room));
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
            return handedOver(room, from, to, now);
          },
        }),
      );
      return results.filter((result) => result.changed).map((result) => result.room);
    },

    /**
     * The owner renamed the player's account after reports (CC-044, ADR-071.6): their seat in every open room takes
     * the new name, so the others stop seeing the old one and a game that ends later is recorded under the new one.
     * Each changed room is told.
     *
     * @param {{ playerId: string, displayName: string, now: number }} input
     * @returns {Promise<Array<Readonly<import("../../data/roomAccessor.js").Room>>>} rooms that changed
     */
    async renamePlayer({ playerId, displayName, now }) {
      const results = await eachRoom(await roomAccessor.listBySeat(playerId), (stored) =>
        change({
          code: stored.code,
          now,
          decide(room) {
            const seat = seatOf(room, playerId);
            if (seat === undefined || seat.displayName === displayName) return room;
            const seats = room.seats.map((each) => (each === seat ? { ...each, displayName } : each));
            return { ...room, seats };
          },
        }),
      );
      return announce(
        results.filter((result) => !result.closed && result.changed).map((result) => result.room),
      );
    },

    /**
     * The player deleted their account (CC-035). In every room they sit in, an anonymous stand-in takes their place
     * first and then leaves: a running game is forfeited, so the other player wins and the match is recorded with
     * the stand-in, a waiting seat is given up, and a finished room loses its rematch. Nothing in a room names the
     * player afterwards, and a game that ends later cannot write their data back.
     *
     * @param {{ playerId: string, standIn: () => Readonly<{ id: string, displayName: string }>, now: number }} input
     *   `standIn` makes a new stand-in for each room
     * @returns {Promise<Array<Readonly<import("../../data/roomAccessor.js").Room>>>} rooms that changed and are still open
     */
    async erasePlayer({ playerId, standIn, now }) {
      const results = await eachRoom(await roomAccessor.listBySeat(playerId), (stored) =>
        change({
          code: stored.code,
          now,
          decide(room) {
            if (seatOf(room, playerId) === undefined) return room;
            const stand = standIn();
            return leaving(handedOver(room, playerId, stand, now), stand.id, now);
          },
        }),
      );
      return results.filter((result) => !result.closed && result.changed).map((result) => result.room);
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
     * How many open rooms there are of each game in each status, zero included, for the operations gauge
     * (ADR-055). Read only when telemetry takes a reading.
     *
     * @returns {Promise<ReadonlyArray<Readonly<{ gameId: string, status: string, rooms: number }>>>}
     */
    countRoomsByGame: () => roomAccessor.countByGameAndStatus(),

    /**
     * The game of every stored room that is finished, as `room.gameFinished` announced it. The match pipeline adds
     * them again at startup and now and then (CC-111): a game whose announcement was lost to a crash or a database
     * blip still reaches it while its room waits for a rematch. Rooms whose time is up are listed too, because a
     * game is never lost for being late. An aborted game is not a match (CC-036), so it is not listed.
     *
     * @returns {Promise<Array<{ room: Readonly<import("../../data/roomAccessor.js").Room>, outcome: object }>>}
     */
    async listFinishedGames() {
      const rooms = await roomAccessor.listAll();
      return rooms
        .filter((room) => room.status === ROOM_STATUS.FINISHED && !isAborted(room))
        .map((room) => ({ room, outcome: room.result }));
    },

    /**
     * What one viewer may see. Seated players get their own game view, anyone else sees the spectator view.
     *
     * Every player is named by their seat id, never by their player id (CC-253, ADR-057). The fields keep their
     * names: `hostId`, `seats[].playerId`, `you`, the requests' `from` and `to`, the winners, the active players,
     * the series' wins and everything in the game's own view hold seat ids. `you` is the viewer's own seat id, ""
     * for a viewer without a seat.
     *
     * @param {Readonly<import("../../data/roomAccessor.js").Room>} room
     * @param {string} viewerId
     */
    viewFor(room, viewerId) {
      const engine = engineFor(room);
      const seated = seatOf(room, viewerId) !== undefined;
      const seatIdOf = (playerId) => seatIds.seatIdOf(room, playerId);
      const view = {
        code: room.code,
        gameId: room.gameId,
        status: room.status,
        hostId: seatIdOf(room.hostId),
        players: { min: engine.players.min, max: engine.players.max },
        seats: room.seats.map((seat) => ({
          playerId: seatIdOf(seat.playerId),
          displayName: seat.displayName,
          // Only an avatar still in the catalogue, so a stored value can never be anything else.
          ...(isAvatarId(seat.avatar) && { avatar: seat.avatar }),
          // The page needs to know a deleted player's stand-in cannot be blocked, without reading its id.
          ...(isDeletedPlayerId(seat.playerId) && { deleted: true }),
          connected: seat.connected,
          presence: presenceOf(seat),
          since: presenceSince(room, seat),
          graceUntil: graceUntil(room, seat, lifetimes),
          // A computer player is labelled in every view, so nobody takes it for a person (ADR-025).
          ...(seat.bot !== undefined && { bot: { character: seat.bot.character, level: seat.bot.level } }),
        })),
        you: yourSeatId(room, viewerId),
        // Rooms stored before requests existed (CC-159) have none.
        requests: withSeatIds(
          room,
          (room.requests ?? []).map((request) => ({ ...request })),
        ),
        requestsLeft: requestsLeft(room, { viewerId, engine, lifetimes }),
        askAgainAt: askAgainAt(room, { viewerId, lifetimes }),
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
            available: room.rematch.available,
            until: lifetimeOf(room, lifetimes).endsAt,
            // Only after a player left the finished game: who it was (CC-162).
            ...(room.rematch.leftName !== undefined && { leftName: room.rematch.leftName }),
          },
        }),
        ...(room.series && {
          series: { games: room.series.games, wins: withSeatIds(room, { ...room.series.wins }) },
        }),
        ...(room.game.seals?.length > 0 && { fairness: withSeatIds(room, botTurns.fairness(room)) }),
        // The game's own view names players however its engine likes, so all of it is renamed.
        game: withSeatIds(room, {
          // Which match this is, so the result can show the progress update the server sends for it (CC-235).
          matchId: room.game.matchId,
          view: engine.viewFor(room.game.state, seated ? viewerId : "spectator"),
          activePlayers: room.status === ROOM_STATUS.PLAYING ? engine.activePlayers(room.game.state) : [],
          outcome,
          number: gameNumberOf(room),
          turnEndsAt: turnLimit(room, { engine, lifetimes }).endsAt,
        }),
      };
    },
  };

  return Object.freeze(component);
}
