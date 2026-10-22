import {
  CHALLENGE_LIMIT_REASONS,
  CHALLENGE_LIMITS,
  CHALLENGE_STATES,
  DAILY_PUZZLE_REFUSALS,
  ERROR_CODES,
  MOVE_REJECTIONS,
  NAME_REFUSALS,
  ROOM_JOIN_REFUSALS,
  ROOM_LIMIT_REASONS,
  TOO_YOUNG_MESSAGE,
} from "@classicade/shared";

/** Codes the web app gives a failure itself, when the server never answered or answered nothing it knows. */
const CLIENT_CODES = Object.freeze({ NETWORK: "NETWORK", TIMEOUT: "TIMEOUT", UNKNOWN: "UNKNOWN" });

/** What a player reads when nothing more is known about a failure (CC-350). The Retry button is the next step. */
export const FALLBACK_WORDS = "Something went wrong. Try again.";

/**
 * What a player reads for each kind of failure: what went wrong and what to do next (CC-350, CL-02). A server's own
 * message is never shown, because it is written for developers and may change. Every code in ERROR_CODES has a
 * line here, and a test checks it.
 */
export const PLAYER_WORDS = Object.freeze({
  [ERROR_CODES.VALIDATION_FAILED]: "That wasn't accepted. Check what you entered and try again.",
  [ERROR_CODES.BAD_REQUEST]: "ClassiCade couldn't read that. Reload the page and try again.",
  [ERROR_CODES.UNAUTHORIZED]: "Your session ended. Reload the page to keep playing.",
  [ERROR_CODES.FORBIDDEN]: "That isn't open to you. Go back and choose something else.",
  [ERROR_CODES.NOT_FOUND]: "We couldn't find that. It may have been removed. Go back and try again.",
  [ERROR_CODES.CONFLICT]:
    "That can't be done right now. Reload the page to see what changed, then try again.",
  [ERROR_CODES.GONE]: "That has ended. Go back and start something new.",
  [ERROR_CODES.PAYLOAD_TOO_LARGE]: "That was too long to send. Make it shorter and try again.",
  [ERROR_CODES.RATE_LIMITED]: "Too many tries in a row. Wait a minute, then try again.",
  [ERROR_CODES.SERVER_BUSY]: "ClassiCade is very busy right now. Wait a minute, then try again.",
  [ERROR_CODES.UNSUPPORTED_MEDIA_TYPE]: "ClassiCade couldn't read that. Reload the page and try again.",
  [ERROR_CODES.INTERNAL]: "That didn't work on our side. Try again in a moment.",
  [CLIENT_CODES.NETWORK]: "We couldn't reach ClassiCade. Check your connection, then try again.",
  [CLIENT_CODES.TIMEOUT]: "ClassiCade is slow to answer. Check your connection and try again.",
  [CLIENT_CODES.UNKNOWN]: FALLBACK_WORDS,
});

/**
 * Closer words for a failure whose `details.reason` (or, for a challenge that ended, `details.state`) the server
 * names, by code and then by reason. They say more than the code alone, for example which rule a move broke.
 */
export const REASON_WORDS = Object.freeze({
  [ERROR_CODES.VALIDATION_FAILED]: Object.freeze({
    [MOVE_REJECTIONS.NOT_A_PLAYER]: "You're watching this game, so you can't make a move.",
    [MOVE_REJECTIONS.NOT_YOUR_TURN]: "It's not your turn yet. Wait for the other player.",
    [MOVE_REJECTIONS.INVALID_MOVE]: "That move can't be played. Choose another one.",
    [MOVE_REJECTIONS.ILLEGAL_MOVE]: "That move isn't allowed. Choose another one.",
    [MOVE_REJECTIONS.GAME_OVER]: "The game is over, so there are no more moves.",
    [DAILY_PUZZLE_REFUSALS.ILLEGAL_MOVE]:
      "That move isn't allowed here. Try another one. It isn't a mistake.",
    "too-young": TOO_YOUNG_MESSAGE,
    [NAME_REFUSALS.RESERVED]: "That name is reserved. Please choose another name.",
    [NAME_REFUSALS.UNSUITABLE]:
      "Please choose another name. Names are shown to everyone, so keep it friendly.",
  }),
  [ERROR_CODES.CONFLICT]: Object.freeze({
    [ROOM_JOIN_REFUSALS.STARTED]:
      "This game started without you, so you can't join it. Ask your friend for a new link, or start your own game.",
    [ROOM_JOIN_REFUSALS.FULL]:
      "Two players are already in this room. Ask your friend for a new link, or start your own game.",
    [ROOM_LIMIT_REASONS.WAITING_ROOMS]:
      "You have too many rooms waiting for a player. Close one, then try again.",
    [ROOM_LIMIT_REASONS.NETWORK_ROOMS]: "Too many rooms are open from your network. Try again later.",
    [CHALLENGE_LIMIT_REASONS.OPEN]: `You can have ${CHALLENGE_LIMITS.openPerSender} challenges open at once. Take one back first.`,
    [CHALLENGE_LIMIT_REASONS.SAME_PERSON]: "You challenged them a moment ago. Try again in a few minutes.",
    [DAILY_PUZZLE_REFUSALS.DAY_OVER]: "A new puzzle is out. Open it to keep playing.",
    [DAILY_PUZZLE_REFUSALS.FINISHED]: "Today's puzzle is over for you. Come back tomorrow for a new one.",
    [DAILY_PUZZLE_REFUSALS.NO_HINTS_LEFT]: "No hints left today. Try the move yourself.",
    [DAILY_PUZZLE_REFUSALS.CHANGED]: "The puzzle changed in another tab. Reload the page to see it.",
  }),
  [ERROR_CODES.SERVER_BUSY]: Object.freeze({
    [ROOM_LIMIT_REASONS.SERVER_FULL]:
      "ClassiCade has as many games as it can hold. Wait a minute, then try again.",
  }),
  [ERROR_CODES.GONE]: Object.freeze({
    [CHALLENGE_STATES.ACCEPTED]: "Someone already took this challenge. Send a new one, or start a game.",
    [CHALLENGE_STATES.DECLINED]: "This challenge was turned down. Send a new one, or start a game.",
    [CHALLENGE_STATES.EXPIRED]: "This challenge has run out of time. Send a new one, or start a game.",
    [CHALLENGE_STATES.WITHDRAWN]: "This challenge was taken back. Send a new one, or start a game.",
  }),
});

/**
 * Closer words for a refused field that means one thing only, by its `details.field`. A field that the server
 * refuses for several reasons, such as a new password, keeps its code's words.
 */
export const FIELD_WORDS = Object.freeze({
  [ERROR_CODES.VALIDATION_FAILED]: Object.freeze({
    currentPassword: "That isn't your current password. Check it and try again.",
  }),
});

/** The words of `table[code][key]`, when the table has them. */
const lookUp = (table, code, key) =>
  typeof key === "string" && Object.hasOwn(table, code) && Object.hasOwn(table[code], key)
    ? table[code][key]
    : undefined;

/** @param {string} code  @param {Record<string, unknown>} details */
const wordsFor = (code, details) =>
  lookUp(REASON_WORDS, code, details.reason ?? details.state) ??
  lookUp(FIELD_WORDS, code, details.field) ??
  (Object.hasOwn(PLAYER_WORDS, code) ? PLAYER_WORDS[code] : FALLBACK_WORDS);

/**
 * A failed request to the server (HTTP or socket), carrying the server's stable error `code`
 * (ERROR_CODES) so UI code can react to the kind of failure, never to message text.
 *
 * `message` is what a player reads, from the tables above, so every place that shows it shows plain words
 * (CC-350). The server's own text stays in `serverMessage`, for logs and tests only.
 */
export class AppRequestError extends Error {
  /**
   * @param {{ code: string, message: string, details?: Record<string, unknown>, status?: number }} error
   */
  constructor({ code, message, details = {}, status = 0 }) {
    super(wordsFor(code, details));
    this.name = "AppRequestError";
    this.code = code;
    this.details = details;
    this.status = status;
    this.serverMessage = message;
  }
}

/**
 * The words a player reads for anything an action threw. A failed request gets its words from the tables above.
 * Anything else is a fault in the page, whose own text means nothing to a player.
 *
 * @param {unknown} err
 */
export const playerMessage = (err) => (err instanceof AppRequestError ? err.message : FALLBACK_WORDS);

/** For network failures (offline, server down): no response at all. */
export const networkError = (cause) =>
  Object.assign(new AppRequestError({ code: CLIENT_CODES.NETWORK, message: "No answer from the server" }), {
    cause,
  });

export const isUnauthorized = (err) =>
  err instanceof AppRequestError && err.code === ERROR_CODES.UNAUTHORIZED;

/** The server has nothing at that address, or will not say that it has (the owner console, CC-233). */
export const isNotFound = (err) => err instanceof AppRequestError && err.code === ERROR_CODES.NOT_FOUND;

/** Failures where the same request can work a moment later: no answer, a timeout, a server fault, too many tries. */
const RETRYABLE_CODES = new Set([
  CLIENT_CODES.NETWORK,
  CLIENT_CODES.TIMEOUT,
  CLIENT_CODES.UNKNOWN,
  ERROR_CODES.INTERNAL,
  ERROR_CODES.RATE_LIMITED,
]);

/**
 * Whether a failed action is worth a Retry button (CC-164). A rule the server refused, such as a taken cell or a
 * wrong password, fails the same way every time. It gets an explanation and no Retry.
 *
 * @param {unknown} err  what the action threw
 */
export const isRetryable = (err) =>
  err instanceof AppRequestError && (RETRYABLE_CODES.has(err.code) || err.status >= 500);
