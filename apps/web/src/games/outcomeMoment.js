import { ROOM_END_REASONS } from "@classicade/shared";
import { SOUNDS } from "../lib/sound/sounds.js";
import { outcomeLine as line, wordsFrom } from "./outcomeLine.js";
import { isAborted, resultHeadline } from "./outcomeText.js";
import { gameView } from "./registry.js";
import { seatOf } from "./roomView.js";

/**
 * The outcome moment (CC-163, ADR-050 point 2): how a finished game looks, reads and sounds for the person watching
 * it. This file is the one place that decides it. Every way a game ends comes down to one of a few endings, and
 * each ending has a tone, a stamp, an effect, an icon and a sound in `ENDINGS`. The words come from the room's own
 * reasons here and from each game's `outcomeText` in the client game registry, so a new game or a new reason is
 * worded by adding to its own module. The result card, the board dim, the screen reader and the sounds all read
 * the moment, and nothing here changes what counted: the server decides that (ADR-021).
 *
 * @typedef {import("./outcomeLine.js").OutcomeLine} OutcomeLine
 * @typedef {import("./outcomeLine.js").ReasonWords} ReasonWords
 *
 * @typedef {"won" | "won-quietly" | "lost" | "drew" | "aborted" | "watched"} Ending
 *
 * @typedef {Object} OutcomeMoment
 * @property {Ending} ending
 * @property {string} tone       a TONES value, the colour of the result card
 * @property {string} stamp      the big decorative word over the headline, "" for none
 * @property {string} headline   the result in one sentence (resultHeadline, CC-162)
 * @property {Readonly<OutcomeLine>} line  the line under the headline, Hinglish first
 * @property {"confetti" | "dim" | "none"} effect  what moves: confetti over the page, or the board dimming once
 * @property {string} icon       an achievement glyph shown in the stamp, "" for none
 * @property {string} sound      an id from SOUNDS, "" for none
 */

/** The four tones of a result (ADR-050 point 2). */
export const TONES = Object.freeze({
  WIN: "win",
  QUIET_WIN: "quiet-win",
  GENTLE_LOSS: "gentle-loss",
  EVEN: "even",
});

/**
 * How long the moment plays in milliseconds. The stamp, the confetti and the dim are all done by then. It is the
 * same as `--duration-celebrate` in tokens.css, and the toasts below the result wait for it (CC-099 beat 1).
 */
export const MOMENT_MS = 1_200;

/**
 * What each ending looks and sounds like. A win earned on the board gets confetti. A win the player did not earn
 * there (the opponent left or ran out the move timer) is gold and quiet. A loss is met gently: no stamp, no red, no
 * shake, the board dims once and the soft loss sound plays. A draw, an aborted game and a spectator's view stay
 * even. Spectators never hear a result sound, because it is not their win or loss.
 */
export const ENDINGS = Object.freeze({
  won: Object.freeze({ tone: TONES.WIN, stamp: "Victory!", effect: "confetti", icon: "", sound: SOUNDS.WIN }),
  "won-quietly": Object.freeze({
    tone: TONES.QUIET_WIN,
    stamp: "Victory",
    effect: "none",
    icon: "trophy",
    sound: SOUNDS.WIN_QUIET,
  }),
  lost: Object.freeze({ tone: TONES.GENTLE_LOSS, stamp: "", effect: "dim", icon: "", sound: SOUNDS.LOSS }),
  drew: Object.freeze({ tone: TONES.EVEN, stamp: "Draw", effect: "none", icon: "", sound: SOUNDS.DRAW }),
  aborted: Object.freeze({
    tone: TONES.EVEN,
    stamp: "No result",
    effect: "none",
    icon: "",
    sound: SOUNDS.GAME_VOID,
  }),
  watched: Object.freeze({ tone: TONES.EVEN, stamp: "Game over", effect: "none", icon: "", sound: "" }),
});

// The owner accepted these lines on 2026-10-20, in Hinglish and English, with "tum" (docs/tickets/CC-163.md).

/** The words of the room's own endings, the same in every game (CC-036). Both are wins not earned on the board. */
const roomWords = wordsFrom({
  [ROOM_END_REASONS.FORFEIT]: {
    quiet: true,
    won: ({ loser }) => line(`${loser} game chhod gaye.`, `${loser} left the game.`),
    // Shown when the player comes back to the room. It says what happened, never that they gave up.
    lost: () => line("Tum door the, game khatam ho gaya.", "The game ended while you were away."),
    watched: ({ loser }) => line(`${loser} game chhod gaye.`, `${loser} left the game.`),
  },
  [ROOM_END_REASONS.IDLE]: {
    quiet: true,
    won: ({ loser }) => line(`${loser} ne time pe move nahi kiya.`, `${loser} didn't move in time.`),
    lost: () => line("Move ka timer khatam ho gaya.", "The move timer ran out."),
    drew: () => line("Kisi ka move time pe nahi aaya.", "Neither move came in time."),
    watched: ({ loser }) => line(`${loser} ne time pe move nahi kiya.`, `${loser} didn't move in time.`),
  },
});

/** An aborted game counts for nothing, for anyone watching it. */
const ABORTED_LINE = line(
  "Pehla move nahi aaya. Kuch count nahi hua.",
  "No first move in time. Nothing counted.",
);

/** Kind plain words for a reason that neither the room nor the game words, so a new reason never breaks the card. */
const PLAIN = Object.freeze({
  won: () => line("Shabaash, achha khela.", "Well played."),
  lost: () => line("Achha game tha. Ek aur?", "Good game. Want another?"),
  drew: () => line("Barabar ka muqabla.", "An even game."),
  watched: () => line("Kya match tha.", "What a match."),
});

/** Which ending the viewer sees, given the words for the reason (they say whether a win by it is quiet). */
function endingOf(room, words) {
  const { outcome } = room.game;
  if (isAborted(room)) return "aborted";
  if (outcome.result === "draw") return "drew";
  if (room.you === "") return "watched";
  if (!outcome.winners.includes(room.you)) return "lost";
  return words?.quiet === true ? "won-quietly" : "won";
}

/**
 * The names the lines may use: only the display names already shown in the room. A player who left has no seat any
 * more, so the room's memory of their name stands in (`rematch.leftName`, CC-162).
 */
function namesOf(room) {
  const { winners } = room.game.outcome;
  const gone = room.rematch?.leftName || (room.you === "" ? "A player" : "Your opponent");
  const winner = seatOf(room, winners[0])?.displayName ?? gone;
  const loser = room.seats.find((seat) => !winners.includes(seat.playerId))?.displayName ?? gone;
  return { winner, loser };
}

/** A computer character's tip after the player lost to it on the board, or undefined. */
function characterHint(room, game) {
  const bot = seatOf(room, room.game.outcome.winners[0])?.bot;
  return bot === undefined ? undefined : game.outcomeText?.hint?.(bot);
}

/** The line under the headline. */
function lineOf(room, ending, { words, fromRoom, game }) {
  if (ending === "aborted") return ABORTED_LINE;
  const hint = ending === "lost" && !fromRoom ? characterHint(room, game) : undefined;
  if (hint !== undefined) return hint;
  const key = ending === "won-quietly" ? "won" : ending;
  return (words?.[key] ?? PLAIN[key])(namesOf(room));
}

/**
 * The outcome moment of a finished game for the person watching it: a seated player who won, lost or drew, or a
 * spectator.
 *
 * @param {any} room  a finished RoomView
 * @returns {Readonly<OutcomeMoment>}
 */
export function outcomeMoment(room) {
  const { reason } = room.game.outcome;
  const game = gameView(room.gameId);
  const fromRoom = roomWords(reason);
  const words = fromRoom ?? game.outcomeText?.words(reason);
  const ending = endingOf(room, words);
  const { tone, stamp, effect, icon, sound } = ENDINGS[ending];
  const seated = seatOf(room, room.you) !== undefined;
  return Object.freeze({
    ending,
    tone,
    stamp,
    headline: resultHeadline(room),
    line: lineOf(room, ending, { words, fromRoom: fromRoom !== undefined, game }),
    effect,
    icon,
    sound: seated ? sound : "",
  });
}

/**
 * What the screen reader is told when the game ends: the same words the card shows, the headline and then the
 * line in both languages.
 *
 * @param {Readonly<OutcomeMoment>} moment
 */
export function momentAnnouncement({ headline, line: { hinglish, english } }) {
  const stop = /[.!?]$/.test(headline) ? "" : ".";
  return `${headline}${stop} ${hinglish} ${english}`;
}
