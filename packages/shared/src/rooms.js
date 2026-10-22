/**
 * A room goes from waiting to playing to finished. A closed room is removed, and the players in it are told with
 * ROOM_CLOSED.
 */
export const ROOM_STATUS = Object.freeze({
  WAITING: "waiting",
  PLAYING: "playing",
  FINISHED: "finished",
});

/** Why a room closed: sent with ROOM_CLOSED, and with the GONE error when someone opens a closed room (CC-101). */
export const ROOM_CLOSE_REASONS = Object.freeze({
  /** nobody joined the waiting room in time */
  EXPIRED: "expired",
  /** the last player pressed Leave */
  EMPTY: "empty",
  /** every player was away from a game for too long */
  ABANDONED: "abandoned",
  /** the game finished and nobody started a rematch in time */
  REMATCH_WINDOW_ENDED: "rematch-window-ended",
});

/**
 * Why creating a room was refused, in the `details.reason` of the error (CC-107). The message says what to do.
 */
export const ROOM_LIMIT_REASONS = Object.freeze({
  /** the player already has as many waiting rooms as one player may have */
  WAITING_ROOMS: "waiting-rooms",
  /** the player's network address has opened as many rooms as one network may have open */
  NETWORK_ROOMS: "network-rooms",
  /** the server holds as many rooms as it can */
  SERVER_FULL: "server-full",
});

/**
 * Why joining a room was refused, in the `details.reason` of the 409 answer (CC-350), so the page can say what to
 * do in its own words. A player blocked with someone in the room gets FULL, exactly as a full room would (CC-044).
 */
export const ROOM_JOIN_REFUSALS = Object.freeze({
  /** the game started without this player */
  STARTED: "started",
  /** every seat is taken */
  FULL: "full",
});

/** Why the server refused a request in a room (a rematch, a draw, a claimed win) or a move, in `details.reason` (CC-350). */
export const ROOM_REQUEST_REFUSALS = Object.freeze({
  /** a rematch is asked before the game is over */
  AFTER_GAME_ONLY: "after-game-only",
  /** a request such as a draw is asked when the game is not on */
  DURING_GAME_ONLY: "during-game-only",
  /** nobody else is in the room to answer */
  NO_OPPONENT: "no-opponent",
  /** the same request is already waiting for its answer */
  ALREADY_ASKED: "already-asked",
  /** the same request was answered a moment ago */
  TOO_SOON: "too-soon",
  /** the player asked as often as a game allows */
  ASK_LIMIT: "ask-limit",
  /** only the player who asked can take a request back */
  NOT_ASKER: "not-asker",
  /** the request was not asked of this player */
  NOT_ASKED_OF_YOU: "not-asked-of-you",
  /** the request was answered or ended before this answer came */
  REQUEST_CLOSED: "request-closed",
  /** the other player left after the game, so there is nobody for a rematch */
  OPPONENT_LEFT: "opponent-left",
  /** the game has not started yet */
  NOT_STARTED: "not-started",
  /** the game is over */
  GAME_OVER: "game-over",
  /** a win is claimed while the other player may still come back */
  OPPONENT_MAY_RETURN: "opponent-may-return",
});

/** Room codes avoid look-alike characters (0/O, 1/I/L) so they can be read out loud or typed from a screenshot. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

/**
 * Kinds of request every room offers (CC-159). A game adds its own kinds through its engine's `requestTypes`, such
 * as the chess draw offer (CHESS_REQUEST_TYPES).
 */
export const ROOM_REQUEST_TYPES = Object.freeze({
  /** after a finished game: play again in the same room */
  REMATCH: "rematch",
});

/**
 * Where a request between two players stands (CC-159). It starts open. It ends accepted or declined by the player
 * asked, withdrawn by the player who asked, or expired when nobody answered in time. An ended request stays in the
 * room for a few seconds, so both players are shown how it ended.
 */
export const REQUEST_STATES = Object.freeze({
  OPEN: "open",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  WITHDRAWN: "withdrawn",
  EXPIRED: "expired",
});

/** What a player can do with an open request: accept or decline one they were asked, withdraw their own. */
export const REQUEST_ANSWERS = Object.freeze({
  ACCEPT: "accept",
  DECLINE: "decline",
  WITHDRAW: "withdraw",
});

/**
 * Where a seated player is (CC-158, CC-207): here on the room page, away on another page of the site, or offline
 * with no connection at all.
 */
export const PRESENCE = Object.freeze({
  HERE: "here",
  AWAY: "away",
  OFFLINE: "offline",
});

/**
 * Ways the room itself ends a game, for every game (CC-036). A player who left, or whose opponent claimed the win
 * after they stayed disconnected, loses by forfeit. A player who did not move in time loses as idle. A game where
 * someone never made a first move is aborted: it has the result "aborted", no winner, and nothing is recorded.
 */
export const ROOM_END_REASONS = Object.freeze({
  FORFEIT: "forfeit",
  IDLE: "idle",
  ABORTED: "aborted",
});
