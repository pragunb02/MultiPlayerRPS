import { REQUEST_STATES, ROOM_REQUEST_REFUSALS, ROOM_REQUEST_TYPES, ROOM_STATUS } from "@classicade/shared";
import { ConflictError, ForbiddenError, ValidationError } from "../../utils/errors.js";

/**
 * Requests between the two players of a room (CC-159): a rematch after a finished game, and whatever the game adds
 * during play, such as a chess draw offer. Every kind works the same way. One player asks, the other accepts or
 * declines, the asker may withdraw, and a request nobody answers expires. Only one request of each kind is open at
 * a time. How a request ended stays in the room for a few seconds, so both players are shown the answer. These
 * are pure functions over a room. The room component applies what accepting means.
 *
 * @typedef {import("../../data/roomAccessor.js").RoomRequest} RoomRequest
 *
 * @typedef {Object} RequestRule
 * @property {string} status          the room status the request belongs to: finished for a rematch, playing for
 *   the game's own requests
 * @property {number} lifetimeMs       how long it stays open without an answer
 * @property {number} limitPerPlayer   how often one player may ask in one game, Infinity for no limit
 */

const NONE = Object.freeze([]);
const UNLIMITED = Number.POSITIVE_INFINITY;

const requestsOf = (room) => room.requests ?? NONE;
const isOpen = (request) => request.state === REQUEST_STATES.OPEN;
const isSeated = (room, playerId) => room.seats.some((seat) => seat.playerId === playerId);

/**
 * The rule for one kind of request in this room, or undefined for a kind the room and its game do not know.
 *
 * @param {{ type: string, engine: { requestTypes?: Readonly<Record<string, { lifetimeMs: number, limitPerPlayer: number }>> }, lifetimes: Readonly<import("./roomLifetimes.js").RoomLifetimes> }} input
 * @returns {RequestRule | undefined}
 */
export function ruleFor({ type, engine, lifetimes }) {
  if (type === ROOM_REQUEST_TYPES.REMATCH) {
    return {
      status: ROOM_STATUS.FINISHED,
      lifetimeMs: lifetimes.rematchRequestMs,
      limitPerPlayer: UNLIMITED,
    };
  }
  // The type comes from a player: only the game's own kinds count, never what an object inherits ("constructor").
  if (engine.requestTypes === undefined || !Object.hasOwn(engine.requestTypes, type)) {
    return undefined;
  }
  const own = engine.requestTypes[type];
  return { status: ROOM_STATUS.PLAYING, lifetimeMs: own.lifetimeMs, limitPerPlayer: own.limitPerPlayer };
}

/**
 * The open request of one kind, if there is one.
 *
 * @param {Readonly<object>} room
 * @param {string} type
 * @returns {RoomRequest | undefined}
 */
export const openRequest = (room, type) =>
  requestsOf(room).find((request) => request.type === type && isOpen(request));

/** Every request still open in the room. */
export const openRequests = (room) => requestsOf(room).filter(isOpen);

/** Whether an open request still makes sense in the room as it is now. */
function stillPossible(room, request, rule) {
  if (rule === undefined || rule.status !== room.status) return false;
  if (!isSeated(room, request.from) || !isSeated(room, request.to)) return false;
  return request.type !== ROOM_REQUEST_TYPES.REMATCH || room.rematch?.available === true;
}

/**
 * Brings the requests of a room up to `now`. An open request whose time is up expires. An open request that no
 * longer makes sense goes away without an answer, such as a draw offer once the game is over or a rematch once a
 * player left. An ended request is forgotten once its answer has been shown and the cooldown is over. Answers the
 * same room when nothing changed, so a caller can tell there is nothing to save.
 *
 * @param {Readonly<object>} room
 * @param {{ now: number, rules: (type: string) => RequestRule | undefined, lifetimes: Readonly<import("./roomLifetimes.js").RoomLifetimes> }} input
 */
export function settleRequests(room, { now, rules, lifetimes }) {
  const before = requestsOf(room);
  const keepMs = Math.max(lifetimes.answerKeptMs, lifetimes.reaskCooldownMs);
  let changed = false;
  const after = before.flatMap((request) => {
    if (!isOpen(request)) {
      const keep = now < request.endedAt + keepMs;
      changed ||= !keep;
      return keep ? [request] : [];
    }
    if (!stillPossible(room, request, rules(request.type))) {
      changed = true;
      return [];
    }
    if (now >= request.expiresAt) {
      changed = true;
      return [{ ...request, state: REQUEST_STATES.EXPIRED, endedAt: request.expiresAt }];
    }
    return [request];
  });
  if (!changed) return room;
  return { ...room, requests: after };
}

/** How many times `playerId` asked for `type` in the game being played. */
const askedInGame = (room, type, playerId) => room.game?.asked?.[type]?.[playerId] ?? 0;

/**
 * How many more times the viewer may ask for each kind with a limit, in the game being played. Empty outside a
 * game and for spectators.
 *
 * @param {Readonly<object>} room
 * @param {{ viewerId: string, engine: object, lifetimes: object }} input
 * @returns {Record<string, number>}
 */
export function requestsLeft(room, { viewerId, engine, lifetimes }) {
  if (room.status !== ROOM_STATUS.PLAYING || !isSeated(room, viewerId)) {
    return {};
  }
  return Object.fromEntries(
    Object.keys(engine.requestTypes ?? {}).map((type) => [
      type,
      Math.max(0, ruleFor({ type, engine, lifetimes }).limitPerPlayer - askedInGame(room, type, viewerId)),
    ]),
  );
}

/**
 * Whether asking the same thing again waits for the cooldown after `request`. Only an answer that was not a yes
 * does: after an accepted rematch a quick game may well end within seconds, and asking again then is no nagging.
 */
const coolsDown = (request) => !isOpen(request) && request.state !== REQUEST_STATES.ACCEPTED;

/**
 * When the viewer may ask each kind again after their last request of that kind ended without a yes (the
 * cooldown), for every kind they asked recently. A moment in the past means now.
 *
 * @param {Readonly<object>} room
 * @param {{ viewerId: string, lifetimes: { reaskCooldownMs: number } }} input
 * @returns {Record<string, number>}
 */
export function askAgainAt(room, { viewerId, lifetimes }) {
  return Object.fromEntries(
    requestsOf(room)
      .filter((request) => coolsDown(request) && request.from === viewerId)
      .map((request) => [request.type, request.endedAt + lifetimes.reaskCooldownMs]),
  );
}

/**
 * The room with `playerId`'s new request in it, after checking that they may ask. The room must already be
 * settled. Refuses with a typed error: an unknown kind, the wrong moment, a room without exactly two players, a
 * request of theirs still open, a cooldown after the last one, or a used up limit.
 *
 * @param {Readonly<object>} room
 * @param {{ playerId: string, type: string, now: number, rule: RequestRule | undefined, lifetimes: object }} input
 */
export function addRequest(room, { playerId, type, now, rule, lifetimes }) {
  if (rule === undefined) {
    throw new ValidationError("You cannot ask that in this game", { details: { field: "type" } });
  }
  if (rule.status !== room.status) {
    const afterGame = rule.status === ROOM_STATUS.FINISHED;
    throw new ConflictError(
      afterGame
        ? "A rematch is only possible after the game is over"
        : "That is only possible while the game is on",
      {
        details: {
          reason: afterGame ? ROOM_REQUEST_REFUSALS.AFTER_GAME_ONLY : ROOM_REQUEST_REFUSALS.DURING_GAME_ONLY,
        },
      },
    );
  }
  const others = room.seats.filter((seat) => seat.playerId !== playerId);
  if (others.length !== 1) {
    throw new ConflictError("A request needs one other player in the room", {
      details: { reason: ROOM_REQUEST_REFUSALS.NO_OPPONENT },
    });
  }
  if (openRequest(room, type) !== undefined) {
    throw new ConflictError("You already asked. Wait for the answer", {
      details: { reason: ROOM_REQUEST_REFUSALS.ALREADY_ASKED },
    });
  }
  const last = requestsOf(room).findLast((request) => request.type === type && request.from === playerId);
  if (last !== undefined && coolsDown(last) && now < last.endedAt + lifetimes.reaskCooldownMs) {
    throw new ConflictError("Wait a few seconds before asking again", {
      details: { reason: ROOM_REQUEST_REFUSALS.TOO_SOON, retryAt: last.endedAt + lifetimes.reaskCooldownMs },
    });
  }
  const asked = askedInGame(room, type, playerId);
  if (asked >= rule.limitPerPlayer) {
    throw new ConflictError(`You can ask that ${rule.limitPerPlayer} times a game`, {
      details: { reason: ROOM_REQUEST_REFUSALS.ASK_LIMIT, limit: rule.limitPerPlayer },
    });
  }
  const request = {
    type,
    from: playerId,
    to: others[0].playerId,
    createdAt: now,
    expiresAt: now + rule.lifetimeMs,
    state: REQUEST_STATES.OPEN,
    endedAt: 0,
  };
  const counted =
    rule.limitPerPlayer === UNLIMITED
      ? {}
      : {
          game: {
            ...room.game,
            asked: { ...room.game.asked, [type]: { ...room.game.asked?.[type], [playerId]: asked + 1 } },
          },
        };
  return { ...room, ...counted, requests: [...requestsOf(room), request] };
}

/**
 * The room with an open request ended as `state` at `now`.
 *
 * @param {Readonly<object>} room
 * @param {{ request: RoomRequest, state: string, now: number }} input
 */
export const endRequest = (room, { request, state, now }) => ({
  ...room,
  requests: requestsOf(room).map((each) => (each === request ? { ...each, state, endedAt: now } : each)),
});

/**
 * Checks that `playerId` may give this answer: only the player asked accepts or declines, and only the asker
 * withdraws.
 *
 * @param {{ request: RoomRequest, playerId: string, byAsker: boolean }} input  `byAsker` says whether the answer is
 *   one only the asker may give
 * @throws {ForbiddenError}
 */
export function requireAnswerer({ request, playerId, byAsker }) {
  const allowed = byAsker ? request.from : request.to;
  if (allowed !== playerId) {
    throw new ForbiddenError(
      byAsker ? "Only the player who asked can withdraw it" : "That was not asked of you",
      {
        details: {
          reason: byAsker ? ROOM_REQUEST_REFUSALS.NOT_ASKER : ROOM_REQUEST_REFUSALS.NOT_ASKED_OF_YOU,
        },
      },
    );
  }
}

/**
 * Open requests of the game addressed to `playerId`, declined because they made a move instead of answering.
 *
 * @param {Readonly<object>} room
 * @param {{ playerId: string, now: number }} input
 */
export function declineByMoving(room, { playerId, now }) {
  const asked = requestsOf(room).filter(
    (request) => isOpen(request) && request.to === playerId && request.type !== ROOM_REQUEST_TYPES.REMATCH,
  );
  return asked.reduce(
    (current, request) => endRequest(current, { request, state: REQUEST_STATES.DECLINED, now }),
    room,
  );
}

/** Whether two lists of requests say the same, so a change worth telling the players about can be spotted. */
export const sameRequests = (a, b) => JSON.stringify(a ?? NONE) === JSON.stringify(b ?? NONE);
