/**
 * Socket.IO event contracts shared by server and web. Never use string literals for events.
 *
 * The server answers every event a client sends with `{ ok: true, data } | { ok: false, error: { code, message, details? } }`.
 * Below, "client sends" names the payload and the `data` of the answer. "Server sends" names what the client receives.
 *
 * @typedef {{ gameId: string, options?: Record<string, unknown> }} RoomCreatePayload
 * @typedef {{ code: string }} RoomCodePayload
 * @typedef {{ code: string, move: unknown }} GameMovePayload
 * @typedef {{ gameId: string, level: string, options?: Record<string, unknown> }} PlayComputerPayload   `level` is
 *   a level pick id of the game's character in BOT_CHARACTERS, such as "easy"
 *
 * @typedef {Object} RoomView        what one viewer may see of a room (personalised: hidden info stays hidden)
 * @property {string} code
 * @property {string} gameId
 * @property {"waiting" | "playing" | "finished"} status
 * @property {string} hostId
 * @property {{ min: number, max: number }} players
 * @property {Array<{ playerId: string, displayName: string, connected: boolean, bot?: { character: string, level: string } }>} seats
 *   `bot` marks a computer character (ADR-025), with its character id and level pick from BOT_CHARACTERS
 * @property {{ locked: Array<{ playerId: string, commitment: string }>, checks: Array<{ playerId: string, commitment: string, text: string, salt: string }> } | undefined} fairness
 *   present in a game where a computer player sealed a move (CC-225). `locked` are moves chosen but not shown yet,
 *   each as its lock. `checks` are the shown ones: SHA-256 of `text:salt` in lowercase hexadecimal equals `commitment`
 * @property {string} you             the viewer's player id ("" for spectators)
 * @property {{ matchId: string, view: unknown, activePlayers: string[], outcome: object } | undefined} game   present
 *   once started. `matchId` names this game's match, the same id as in `progress:updated` (CC-235)
 * @property {number} serverTime      server clock (ms) when the view was produced, so client timers do not drift
 * @property {number} revision        counts the room's saved changes. A view with a lower revision than one already
 *   shown is older, because an update can overtake the answer to a request (CC-138)
 * @property {{ requestedBy: string[], available: boolean, until: number, declinedBy: string, leftName?: string } | undefined} rematch
 *   present once finished (CC-037): who asked to play again, whether a rematch can still happen (false once a player
 *   left), when the rematch window ends and the room closes (server time in milliseconds, CC-101), and who last said
 *   no to a request ("" when nobody did since the last request, CC-104). After a player left the finished game,
 *   `leftName` is their display name, because their seat is gone (CC-162).
 * @property {{ games: number, wins: Record<string, number> } | undefined} series   games finished in this room
 *   and wins per player id, across rematches
 */
export const SOCKET_EVENTS = Object.freeze({
  /** Client sends, no payload. Answer: the identity bound to this connection's session. */
  IDENTITY_GET: "identity:get",
  /** Client sends `RoomCreatePayload`. Answer: `RoomView`. */
  ROOM_CREATE: "room:create",
  /**
   * Client sends `PlayComputerPayload`. Answer: `RoomView` of a new room where the game's computer character sits in
   * the other seat and the game has started (CC-138, CC-221).
   */
  ROOM_PLAY_COMPUTER: "room:play-computer",
  /**
   * Client sends `RoomCodePayload`. Answer: `RoomView`. Also used to rejoin after a reconnect. For a day after a
   * room closed, joining it answers GONE with details `{ reason, gameId, closedAt }`, where `reason` is a
   * ROOM_CLOSE_REASONS value (CC-101).
   */
  ROOM_JOIN: "room:join",
  /** Client sends `RoomCodePayload`. Answer: `{ left: true }`. Leaving forfeits a game in progress. */
  ROOM_LEAVE: "room:leave",
  /**
   * Client sends `RoomCodePayload`. Answer: `RoomView`. Turns your rematch request in a finished room on or off.
   * Once every seated player has asked, a new game starts in the same room with the seats reversed (CC-037).
   */
  ROOM_REMATCH: "room:rematch",
  /**
   * Client sends `RoomCodePayload`. Answer: `RoomView`. Says no to the opponent's rematch request (CC-104). Their
   * request is dropped and they see who declined, and either player may still ask again later.
   */
  ROOM_REMATCH_DECLINE: "room:rematch-decline",
  /** Client sends `GameMovePayload`. Answer: `RoomView`. */
  GAME_MOVE: "game:move",
  /** Server sends a `RoomView` after any change in a room you are in. */
  ROOM_UPDATED: "room:updated",
  /** Server sends `{ code, reason }` when a room is closed. The `reason` is a ROOM_CLOSE_REASONS value. */
  ROOM_CLOSED: "room:closed",
  /**
   * Server sends `{ source: "match" | "quest", key, matchId, xpGained, leveledUp, progress }` after XP was awarded.
   * `key` is the match id or the quest key (`quest:<day>:<questId>` or `quest:<day>:sweep`). `matchId` is "" for quests.
   * Also `counted` and `notCountedReason` (CC-095). A match that didn't count for you gave no XP, and the reason is
   * a NOT_COUNTED_REASONS value ("" when it counted). After a counted game against a computer character there is
   * also `botXpLeft`: how much of the day's BOT_DAILY_XP is left (ADR-025).
   */
  PROGRESS_UPDATED: "progress:updated",
  /**
   * Server sends `{ achievements: Achievement[] }` with only the newly unlocked achievements. Each item is shaped
   * like an item of `GET /api/achievements`.
   */
  ACHIEVEMENTS_UNLOCKED: "achievements:unlocked",
  /** Server sends `{ quests: QuestsView }` after any quest progress (shaped like `GET /api/quests`). */
  QUESTS_UPDATED: "quests:updated",
  /** Server sends `{ streaks: StreaksView }` after a counted match (shaped like `GET /api/streaks`). */
  STREAKS_UPDATED: "streaks:updated",
});
