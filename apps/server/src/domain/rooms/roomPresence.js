import { PRESENCE, ROOM_STATUS } from "@classicade/shared";
import { openRequests } from "./roomRequests.js";

/**
 * Where each seated player is, and the times that depend on it (CC-158, CC-207, CC-036). A seat is here while the
 * player has the room page open, away while they are on another page of the site, and offline while they have no
 * connection at all. These are pure functions over a room, with the times from roomLifetimes.js.
 */

/**
 * A seat's presence. Seats stored before away existed only know whether the player is connected.
 *
 * @param {Readonly<import("../../data/roomAccessor.js").Seat>} seat
 * @returns {string} a PRESENCE value
 */
export function presenceOf(seat) {
  if (seat.connected) return PRESENCE.HERE;
  return seat.away === true ? PRESENCE.AWAY : PRESENCE.OFFLINE;
}

/** When the seat's presence last changed. Older seats did not record it, so the room's last activity stands in. */
export const presenceSince = (room, seat) => seat.since ?? room.lastActivityAt;

/**
 * The room with one player's presence set, or the same room when it already was that. `now` becomes the time the
 * presence changed and the room's last activity.
 *
 * @param {Readonly<object>} room
 * @param {{ playerId: string, presence: string, now: number }} input
 */
export function withPresence(room, { playerId, presence, now }) {
  const seat = room.seats.find((each) => each.playerId === playerId);
  if (seat === undefined || presenceOf(seat) === presence) {
    return room;
  }
  return {
    ...room,
    seats: room.seats.map((each) =>
      each === seat
        ? { ...each, connected: presence === PRESENCE.HERE, away: presence === PRESENCE.AWAY, since: now }
        : each,
    ),
    lastActivityAt: now,
  };
}

/**
 * When an offline player's grace period ends in a game still on (after it the opponent may claim the win), or 0.
 *
 * @param {Readonly<object>} room
 * @param {Readonly<object>} seat
 * @param {{ reconnectGraceMs: number }} lifetimes
 */
export function graceUntil(room, seat, lifetimes) {
  if (room.status !== ROOM_STATUS.PLAYING || presenceOf(seat) !== PRESENCE.OFFLINE) return 0;
  return presenceSince(room, seat) + lifetimes.reconnectGraceMs;
}

/**
 * When a player not on the page of a finished room gives up their seat, or 0 while they are there. The time
 * counts from when they left the page, or from the end of the game if they had left before it ended.
 *
 * @param {Readonly<object>} room
 * @param {Readonly<object>} seat
 * @param {{ awayReleaseMs: number }} lifetimes
 */
export function releaseAt(room, seat, lifetimes) {
  if (room.status !== ROOM_STATUS.FINISHED || presenceOf(seat) === PRESENCE.HERE) return 0;
  return Math.max(presenceSince(room, seat), room.finishedAt) + lifetimes.awayReleaseMs;
}

/** Whether the player has made a move in the game being played. */
const hasMoved = (room, playerId) =>
  room.game.log.some((entry) => entry.kind === "move" && entry.playerId === playerId);

/**
 * When the current turn started: the last thing that happened in the game, or the moment the game resumed after a
 * server restart if that is later. A restart starts the turn again, because nobody could move while the server was
 * down and nobody knows for how long it was (PR #67 review).
 */
const turnStart = (game) => Math.max(game.log.at(-1)?.at ?? game.startedAt, game.resumedAt ?? 0);

/** The time given back to the players due in the current turn for being offline, or 0 from an earlier turn. */
const creditOf = (game) => (game.turnCredit?.entries === game.log.length ? game.turnCredit.ms : 0);

/**
 * The idle limit of a game being played (CC-036): when the players due to move lose, or the game is aborted if
 * one of them has not made a first move yet. 0 when no limit runs: nobody is due, or the game has its own clock
 * and everyone due has already moved once.
 *
 * The turn counts from when it started (see `turnStart`). A player due who lost their connection gets the time
 * they were offline back once they return, up to the reconnect grace in one turn (see `withTurnCredit`). While
 * they are still offline the limit is held until that much time could have been given back, so it never runs out
 * on a player who is reconnecting. One who stays away is left to the claim of a win by the opponent (CC-036).
 *
 * @param {Readonly<object>} room
 * @param {{ engine: { activePlayers: Function, turnLimitMs?: number }, lifetimes: { firstMoveMs: number, reconnectGraceMs: number } }} input
 * @returns {{ endsAt: number, firstMove: boolean, due: string[] }}  `firstMove` says whether someone due has not
 *   moved yet, `due` lists the players due to move
 */
export function turnLimit(room, { engine, lifetimes }) {
  const due = room.status === ROOM_STATUS.PLAYING ? engine.activePlayers(room.game.state) : [];
  if (due.length === 0) {
    return { endsAt: 0, firstMove: false, due };
  }
  const firstMove = due.some((playerId) => !hasMoved(room, playerId));
  const limit = firstMove ? lifetimes.firstMoveMs : engine.turnLimitMs;
  if (limit === undefined) {
    return { endsAt: 0, firstMove, due };
  }
  const reconnecting = room.seats.some(
    (seat) => due.includes(seat.playerId) && presenceOf(seat) === PRESENCE.OFFLINE,
  );
  const credit = reconnecting ? lifetimes.reconnectGraceMs : creditOf(room.game);
  return { endsAt: turnStart(room.game) + limit + credit, firstMove, due };
}

/**
 * The room after a presence change, with the time a player due to move was offline during their turn given back to
 * that turn (see `turnLimit`). `before` and `after` are the room before and after `withPresence`. Only a return
 * from offline in a game being played counts, never a switch between the room page and another page, so leaving
 * and coming back never stretches a turn. All the time given back in one turn adds up to the reconnect grace at
 * most, so dropping the connection again and again cannot hold a game up.
 *
 * @param {Readonly<object>} before
 * @param {Readonly<object>} after
 * @param {{ playerId: string, now: number, engine: { activePlayers: Function }, lifetimes: { reconnectGraceMs: number } }} input
 */
export function withTurnCredit(before, after, { playerId, now, engine, lifetimes }) {
  if (after === before || before.status !== ROOM_STATUS.PLAYING) return after;
  const was = before.seats.find((seat) => seat.playerId === playerId);
  const is = after.seats.find((seat) => seat.playerId === playerId);
  if (presenceOf(was) !== PRESENCE.OFFLINE || presenceOf(is) === PRESENCE.OFFLINE) return after;
  if (!engine.activePlayers(before.game.state).includes(playerId)) return after;
  const offlineInTurn = Math.max(0, now - Math.max(presenceSince(before, was), turnStart(before.game)));
  const ms = Math.min(lifetimes.reconnectGraceMs, creditOf(before.game) + offlineInTurn);
  return { ...after, game: { ...after.game, turnCredit: { entries: before.game.log.length, ms } } };
}

/**
 * The next moment something happens in the room without anyone acting, or 0 for none: the game's own deadline (a
 * chess flag), the idle limit, an open request expiring, or a seat of a finished room being given up. Storage
 * keeps it, so the every second check reads only rooms that are due.
 *
 * @param {Readonly<object>} room
 * @param {{ engine: object, lifetimes: object }} input
 */
export function nextDue(room, { engine, lifetimes }) {
  const playing = room.status === ROOM_STATUS.PLAYING;
  const moments = [
    playing && engine.deadline !== undefined ? engine.deadline(room.game.state) : 0,
    turnLimit(room, { engine, lifetimes }).endsAt,
    ...openRequests(room).map((request) => request.expiresAt),
    ...room.seats.map((seat) => releaseAt(room, seat, lifetimes)),
  ].filter((moment) => moment > 0);
  return moments.length === 0 ? 0 : Math.min(...moments);
}
