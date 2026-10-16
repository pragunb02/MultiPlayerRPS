/** Room lifecycle: waiting → playing → finished; closed rooms are removed and announced via ROOM_CLOSED. */
export const ROOM_STATUS = Object.freeze({
  WAITING: "waiting",
  PLAYING: "playing",
  FINISHED: "finished",
});

/** Room codes avoid look-alike characters (0/O, 1/I/L) so they can be read out loud or typed from a screenshot. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
