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
 * @typedef {{ code: string, type: string }} RoomRequestPayload   `type` is ROOM_REQUEST_TYPES.REMATCH or a type
 *   the game adds, such as CHESS_REQUEST_TYPES.DRAW
 * @typedef {{ code: string, type: string, answer: string }} RoomAnswerPayload   `answer` is a REQUEST_ANSWERS value
 *
 * @typedef {Object} RoomRequest      something one player asked the other in a room (CC-159)
 * @property {string} type            ROOM_REQUEST_TYPES or a type the game adds
 * @property {string} from            the player id who asked
 * @property {string} to              the player id who was asked
 * @property {number} createdAt       server time in milliseconds
 * @property {number} expiresAt       when an open request expires, server time
 * @property {string} state           a REQUEST_STATES value
 * @property {number} endedAt         when it stopped being open, 0 while open. Ended requests are kept for 10 s
 *
 * @typedef {Object} SeatView
 * @property {string} playerId
 * @property {string} displayName
 * @property {boolean} connected      on the room page right now
 * @property {string} presence        a PRESENCE value: here, away on another page of the site, or offline (CC-158)
 * @property {number} since           server time when the presence last changed
 * @property {{ character: string, level: string } | undefined} bot   marks a computer character (ADR-025), with
 *   its character id and level pick from BOT_CHARACTERS
 * @property {number} graceUntil      for an offline player in a game still on: when the opponent may claim the win
 *   (CC-036). 0 otherwise
 *
 * @typedef {Object} RoomView        what one viewer may see of a room (personalised: hidden info stays hidden)
 * @property {string} code
 * @property {string} gameId
 * @property {"waiting" | "playing" | "finished"} status
 * @property {string} hostId
 * @property {{ min: number, max: number }} players
 * @property {SeatView[]} seats
 * @property {{ locked: Array<{ playerId: string, commitment: string }>, checks: Array<{ playerId: string, commitment: string, text: string, salt: string }> } | undefined} fairness
 *   present in a game where a computer player sealed a move (CC-225). `locked` are moves chosen but not shown yet,
 *   each as its lock. `checks` are the shown ones: SHA-256 of `text:salt` in lowercase hexadecimal equals `commitment`
 * @property {string} you             the viewer's player id ("" for spectators)
 * @property {RoomRequest[]} requests open requests, and ended ones for 10 s so both players see the answer
 * @property {Record<string, number>} requestsLeft   for each request type with a limit, how many more times the
 *   viewer may ask in this game (the chess draw offer: 3 a game)
 * @property {Record<string, number>} askAgainAt     for each request type the viewer asked recently, when they may
 *   ask again (server time). Asking sooner is refused, so a "no" is not followed at once by the same question
 * @property {{ matchId: string, view: unknown, activePlayers: string[], outcome: object, number: number, turnEndsAt: number } | undefined} game
 *   present once started. `matchId` names this game's match, the same id as in `progress:updated` (CC-235).
 *   `number` counts the games of the room from 1. `turnEndsAt` is when a player who has
 *   not moved by then loses or the game is aborted (CC-036), 0 when no such limit runs
 * @property {number} serverTime      server clock (ms) when the view was produced, so client timers do not drift
 * @property {number} revision        counts the room's saved changes. A view with a lower revision than one already
 *   shown is older, because an update can overtake the answer to a request (CC-138)
 * @property {{ available: boolean, until: number, leftName?: string } | undefined} rematch   present once finished
 *   (CC-037): whether a rematch can still happen (false once a player left), and when the rematch window ends and
 *   the room closes (server time in milliseconds, CC-101). After a player left the finished game, `leftName` is
 *   their display name, because their seat is gone (CC-162).
 * @property {{ games: number, wins: Record<string, number> } | undefined} series   games finished in this room
 *   and wins per player id, across rematches
 *
 * @typedef {Object} SiteRequests     the requests of one room, pushed to every tab of its players whatever page
 *   they are on (CC-207). It replaces whatever the tab knew about that room's requests
 * @property {string} code            the room
 * @property {string} gameId
 * @property {Record<string, string>} names   display name of each seated player, by player id
 * @property {RoomRequest[]} requests open requests, and ended ones for 10 s
 * @property {number} serverTime
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
   * Client sends `RoomCodePayload` when it stops showing the room, because the player went to another page
   * (CC-207). The seat stays theirs and the opponent sees them as away. Answer: `{ away: true }`.
   */
  ROOM_AWAY: "room:away",
  /**
   * Client sends `RoomRequestPayload`. Answer: `RoomView`. Asks the other player something (CC-159): a rematch
   * after a finished game, or what the game adds, such as a draw offer. Asking for what the other player already
   * asked you accepts it.
   */
  ROOM_REQUEST: "room:request",
  /** Client sends `RoomAnswerPayload`. Answer: `RoomView`. Accepts, declines or withdraws an open request. */
  ROOM_ANSWER: "room:answer",
  /**
   * Client sends `RoomCodePayload`. Answer: `RoomView`. Claims the win of a game still on whose opponent has been
   * offline for longer than the grace period (CC-036).
   */
  ROOM_CLAIM_WIN: "room:claim-win",
  /** Client sends `GameMovePayload`. Answer: `RoomView`. */
  GAME_MOVE: "game:move",
  /** Server sends a `RoomView` after any change in a room you are in. */
  ROOM_UPDATED: "room:updated",
  /** Server sends `{ code, reason }` when a room is closed. The `reason` is a ROOM_CLOSE_REASONS value. */
  ROOM_CLOSED: "room:closed",
  /**
   * Server sends `SiteRequests` to every tab of a room's players whenever a request between them opens or ends,
   * and on connecting for every room with a request still open (CC-207).
   */
  REQUEST_UPDATED: "request:updated",
  /** Server sends `{}` to everyone just before it stops for a restart (CC-158). Rooms are kept and rejoined. */
  SERVER_RESTARTING: "server:restarting",
  /**
   * Server sends `{ source: "match" | "quest", key, matchId, xpGained, leveledUp, progress }` after XP was awarded.
   * `key` is the match id or the quest key (`quest:<day>:<questId>` or `quest:<day>:sweep`). `matchId` is "" for quests.
   * Also `counted` and `notCountedReason` (CC-095). A match that didn't count for you gave no XP, and the reason is
   * a NOT_COUNTED_REASONS value ("" when it counted). After a counted game against a computer character there is
   * also `botXpLeft`: how much of the day's BOT_DAILY_XP is left (ADR-025).
   */
  PROGRESS_UPDATED: "progress:updated",
  /**
   * Client sends `RoomCodePayload` for a room this tab has open. Answer: `{ ratings: RoomRating[] }`, the chess
   * rating of each person seated (CC-042), in seat order: `{ seat, rating, deviation, games, provisional, change? }`.
   * `seat` is the place in `RoomView.seats` (0 first). A rating never carries a player id (CC-253).
   * `provisional` is true for the first 10 rated games, and `change` is what the room's current game changed. A
   * game without a rating answers an empty list. A tab that has not joined the room is refused.
   */
  RATING_ROOM: "rating:room",
  /**
   * Server sends `{ matchId, ratings: RoomRating[] }` to everyone in the room once a rated game changed both
   * players' chess ratings (CC-042). The ratings are shaped like the answer to `rating:room`. It can come twice for
   * one game, when the server runs the rating step again.
   */
  RATING_UPDATED: "rating:updated",
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
