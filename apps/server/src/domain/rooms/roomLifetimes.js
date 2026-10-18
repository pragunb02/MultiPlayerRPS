import { ROOM_CLOSE_REASONS, ROOM_STATUS } from "@classicade/shared";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * How long rooms live. This is the one place these business rules are written down (CC-101).
 *
 * 1. A waiting room that nobody joins closes `waitingMs` after the last thing that happened in it.
 * 2. A finished game offers a rematch for `rematchWindowMs` from the moment it ended, then the room closes. The
 *    deadline is fixed and shown to the players, so asking for a rematch does not move it.
 * 3. A game in progress where every person is away (phones lock, tabs close, networks drop) is kept for `awayMs`
 *    after the last thing that happened. That is long enough to come back from a lock screen, a train tunnel or
 *    a meal.
 * 4. A game in progress where nobody makes a move closes after `idleGameMs` even if a tab is still open, so a
 *    forgotten tab cannot keep a room forever.
 * 5. What is left of a closed room (its code, game, reason and time) is kept for `closedRecordMs`, so whoever
 *    comes back with the link learns why it is gone instead of being told it never existed.
 *
 * The things that happen inside a room have their own times (CC-159, CC-207, CC-036):
 *
 * 6. A rematch request stays open for `rematchRequestMs`. A minute is long enough to come back from another tab,
 *    and short enough that nobody waits on a player who has gone.
 * 7. How a request ended stays in the room for `answerKeptMs`, so a player who was looking elsewhere still sees
 *    the answer. After an answer that was not a yes, the same player may ask the same thing again only after
 *    `reaskCooldownMs`, so a "no" is not followed at once by the same question.
 * 8. A player who stays off the page of a finished room for `awayReleaseMs` gives up their seat. The opponent is
 *    told at once that there will be no rematch, instead of waiting for someone who has moved on.
 * 9. A player who loses their connection during a game has `reconnectGraceMs` to come back. A minute covers a
 *    phone lock screen, a switch from mobile data to wifi and a server restart. After it the opponent may claim
 *    the win.
 * 10. A player who has not made their first move of a game within `firstMoveMs` of their turn starting aborts it,
 *     and nothing is recorded. Later moves have each game's own limit (the engine's `turnLimitMs`). A server
 *     restart starts the current turn again, and a player due to move who was offline gets that time back, up to
 *     `reconnectGraceMs` in one turn, so nobody loses a game for time they could not play (roomPresence.js).
 */
export const ROOM_LIFETIMES = Object.freeze({
  waitingMs: 30 * MINUTE_MS,
  rematchWindowMs: 30 * MINUTE_MS,
  awayMs: 2 * HOUR_MS,
  idleGameMs: 24 * HOUR_MS,
  closedRecordMs: 24 * HOUR_MS,
  rematchRequestMs: MINUTE_MS,
  answerKeptMs: 10 * SECOND_MS,
  reaskCooldownMs: 10 * SECOND_MS,
  awayReleaseMs: 2 * MINUTE_MS,
  reconnectGraceMs: MINUTE_MS,
  firstMoveMs: MINUTE_MS,
});

/** @typedef {typeof ROOM_LIFETIMES} RoomLifetimes */

/**
 * Checks a set of lifetimes, filling in the standard value for any not given. Browser tests use short ones so a
 * test can watch a room close. Production always runs with the standard values.
 *
 * @param {Partial<RoomLifetimes>} [overrides]
 * @returns {Readonly<RoomLifetimes>}
 * @throws {TypeError} for an unknown name or a value that is not a positive whole number of milliseconds
 */
export function roomLifetimes(overrides = {}) {
  for (const [name, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(ROOM_LIFETIMES, name)) {
      throw new TypeError(`Unknown room lifetime: ${name}`);
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Room lifetime ${name} must be a positive number of milliseconds`);
    }
  }
  return Object.freeze({ ...ROOM_LIFETIMES, ...overrides });
}

/**
 * When a room's life ends, and what the players will be told then.
 *
 * @param {Readonly<import("../../data/roomAccessor.js").Room>} room
 * @param {Readonly<RoomLifetimes>} lifetimes
 * @returns {{ endsAt: number, reason: string }}
 */
export function lifetimeOf(room, lifetimes) {
  switch (room.status) {
    case ROOM_STATUS.WAITING:
      return { endsAt: room.lastActivityAt + lifetimes.waitingMs, reason: ROOM_CLOSE_REASONS.EXPIRED };
    case ROOM_STATUS.FINISHED:
      return {
        endsAt: room.finishedAt + lifetimes.rematchWindowMs,
        reason: ROOM_CLOSE_REASONS.REMATCH_WINDOW_ENDED,
      };
    default: {
      // A computer player is always there (CC-138), so only people decide whether everyone is away.
      const everyoneAway = room.seats
        .filter((seat) => seat.bot === undefined)
        .every((seat) => !seat.connected);
      return {
        endsAt: room.lastActivityAt + (everyoneAway ? lifetimes.awayMs : lifetimes.idleGameMs),
        reason: ROOM_CLOSE_REASONS.ABANDONED,
      };
    }
  }
}
