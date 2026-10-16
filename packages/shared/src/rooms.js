/** Room lifecycle: waiting → playing → finished; closed rooms are removed and announced via ROOM_CLOSED. */
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

/** Room codes avoid look-alike characters (0/O, 1/I/L) so they can be read out loud or typed from a screenshot. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
