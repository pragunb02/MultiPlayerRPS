/**
 * Socket.IO event contracts shared by server and web. Never use string literals for events.
 *
 * Client → server events are acknowledged with `{ ok: true, data } | { ok: false, error: { code, message, details? } }`.
 *
 * @typedef {{ gameId: string, options?: Record<string, unknown> }} RoomCreatePayload
 * @typedef {{ code: string }} RoomCodePayload
 * @typedef {{ code: string, move: unknown }} GameMovePayload
 *
 * @typedef {Object} RoomView        what one viewer may see of a room (personalised: hidden info stays hidden)
 * @property {string} code
 * @property {string} gameId
 * @property {"waiting" | "playing" | "finished"} status
 * @property {string} hostId
 * @property {{ min: number, max: number }} players
 * @property {Array<{ playerId: string, displayName: string, connected: boolean }>} seats
 * @property {string} you             the viewer's player id ("" for spectators)
 * @property {{ view: unknown, activePlayers: string[], outcome: object } | undefined} game   present once started
 */
export const SOCKET_EVENTS = Object.freeze({
  /** client → server: returns the identity bound to this connection's session */
  IDENTITY_GET: "identity:get",
  /** client → server, RoomCreatePayload → RoomView */
  ROOM_CREATE: "room:create",
  /** client → server, RoomCodePayload → RoomView (also used to rejoin after a reconnect) */
  ROOM_JOIN: "room:join",
  /** client → server, RoomCodePayload → { left: true } (forfeits a game in progress) */
  ROOM_LEAVE: "room:leave",
  /** client → server, GameMovePayload → RoomView */
  GAME_MOVE: "game:move",
  /** server → client: RoomView after any change in a room you are in */
  ROOM_UPDATED: "room:updated",
  /** server → client: { code, reason } when a room is closed (expired, emptied) */
  ROOM_CLOSED: "room:closed",
  /** server → client, after each recorded match: { matchId, xpGained, leveledUp, progress } */
  PROGRESS_UPDATED: "progress:updated",
});
