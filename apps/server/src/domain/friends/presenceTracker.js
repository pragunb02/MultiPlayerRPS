import { FRIEND_PRESENCE, ROOM_STATUS } from "@classicade/shared";
import { assertFunction } from "../../utils/assert.js";

/** What the presence tracker announces on the domain events. */
export const PRESENCE_EVENTS = Object.freeze({
  /** `{ playerId }`: what friends should see of the player may have changed */
  CHANGED: "presence.changed",
});

/** The people of a room whose game is on: computer players are never anyone's friend. */
const playingIn = (room) =>
  room.status === ROOM_STATUS.PLAYING
    ? room.seats.filter((seat) => seat.bot === undefined).map((seat) => seat.playerId)
    : [];

/**
 * Where each player is, as friends may see it (CC-052, ADR-066.6): online while they have a tab open on the site,
 * playing while they also sit in a room whose game is on, offline otherwise. It lives in this process only and is
 * never stored: a restart starts again from nothing, and every tab connects again by itself. It never says which
 * room or which game.
 *
 * The gateway tells it when a player's tabs connect and disconnect, and the composition root tells it about every
 * room change. Each time what a friend would see changes, it announces `PRESENCE_EVENTS.CHANGED`. Appear offline is
 * applied by the friend component, which knows who asked for it.
 *
 * @param {{
 *   rooms: { seatedRooms: (query: { playerId: string }) => Promise<ReadonlyArray<Readonly<{ code: string, status: string, seats: ReadonlyArray<{ playerId: string, bot?: object }> }>>> },
 *   events: { emit: (name: string, payload: object) => unknown },
 * }} deps  `rooms` answers the rooms a player sits in, read once when they first connect
 */
export function createPresenceTracker({ rooms, events }) {
  assertFunction(rooms?.seatedRooms, "rooms.seatedRooms");
  assertFunction(events?.emit, "events.emit");

  /** @type {Map<string, number>} open tabs per player */
  const tabs = new Map();
  /** @type {Map<string, Set<string>>} the people of each room whose game is on, by room code */
  const playing = new Map();
  /** @type {Map<string, Set<string>>} the same, by player */
  const roomsOf = new Map();
  // While a first tab's rooms are being read, the rooms that change meanwhile, by the count of changes then. A read
  // answers what the database held when it started, so a room that changed since is left to its own change.
  let changes = 0;
  let reading = 0;
  /** @type {Map<string, number>} */
  const changedAt = new Map();
  const noteChange = (code) => {
    changes += 1;
    if (reading > 0) changedAt.set(code, changes);
  };

  function statusOf(playerId) {
    if ((tabs.get(playerId) ?? 0) === 0) return FRIEND_PRESENCE.OFFLINE;
    return (roomsOf.get(playerId)?.size ?? 0) > 0 ? FRIEND_PRESENCE.PLAYING : FRIEND_PRESENCE.ONLINE;
  }

  /** Runs a change and announces each player whose status it changed. */
  function changing(playerIds, change) {
    const before = new Map(playerIds.map((id) => [id, statusOf(id)]));
    change();
    for (const [playerId, status] of before) {
      if (statusOf(playerId) !== status) events.emit(PRESENCE_EVENTS.CHANGED, { playerId });
    }
  }

  /** Records who plays in a room now, and forgets the ones who no longer do. */
  function setPlaying(code, playerIds) {
    const now = new Set(playerIds);
    const was = playing.get(code) ?? new Set();
    for (const playerId of was) {
      if (!now.has(playerId)) {
        roomsOf.get(playerId).delete(code);
        if (roomsOf.get(playerId).size === 0) roomsOf.delete(playerId);
      }
    }
    for (const playerId of now) {
      if (!roomsOf.has(playerId)) roomsOf.set(playerId, new Set());
      roomsOf.get(playerId).add(code);
    }
    if (now.size === 0) playing.delete(code);
    else playing.set(code, now);
  }

  return Object.freeze({
    /**
     * One tab of the player connected. The first one reads the rooms they sit in, so a game that was on before a
     * restart shows as one.
     *
     * @param {{ playerId: string }} input
     */
    async connected({ playerId }) {
      const first = (tabs.get(playerId) ?? 0) === 0;
      changing([playerId], () => tabs.set(playerId, (tabs.get(playerId) ?? 0) + 1));
      if (!first) return;
      const startedAt = changes;
      reading += 1;
      let seated;
      try {
        seated = await rooms.seatedRooms({ playerId });
      } finally {
        reading -= 1;
      }
      const on = seated.filter(
        (room) => playingIn(room).includes(playerId) && (changedAt.get(room.code) ?? 0) <= startedAt,
      );
      if (reading === 0) changedAt.clear();
      changing([playerId], () =>
        on.forEach((room) => setPlaying(room.code, [...(playing.get(room.code) ?? []), playerId])),
      );
    },

    /**
     * One tab of the player closed.
     *
     * @param {{ playerId: string }} input
     */
    disconnected({ playerId }) {
      changing([playerId], () => {
        const left = (tabs.get(playerId) ?? 1) - 1;
        if (left <= 0) tabs.delete(playerId);
        else tabs.set(playerId, left);
      });
    },

    /**
     * A room was saved with a change: who plays in it may have changed.
     *
     * @param {Readonly<{ code: string, status: string, seats: ReadonlyArray<{ playerId: string, bot?: object }> }>} room
     */
    roomChanged(room) {
      noteChange(room.code);
      const people = playingIn(room);
      const affected = [...new Set([...(playing.get(room.code) ?? []), ...people])];
      changing(affected, () => setPlaying(room.code, people));
    },

    /**
     * A room closed: nobody plays in it any more.
     *
     * @param {{ code: string }} room
     */
    roomClosed({ code }) {
      noteChange(code);
      changing([...(playing.get(code) ?? [])], () => setPlaying(code, []));
    },

    /**
     * @param {string} playerId
     * @returns {string} a FRIEND_PRESENCE value
     */
    statusOf,
  });
}
