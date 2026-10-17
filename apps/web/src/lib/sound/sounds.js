/**
 * Every sound the app can make (CC-103). Games and components name a sound by these ids, and the sound player turns
 * an id into notes. Nothing here is an audio file: each sound is a few short synthesised notes, so there is
 * nothing to download, nothing to license, and the strict CSP needs no change.
 */
export const SOUNDS = Object.freeze({
  MOVE: "move",
  CAPTURE: "capture",
  CHECK: "check",
  CASTLE: "castle",
  PLACE: "place",
  LINE: "line",
  REVEAL: "reveal",
  ROUND_WON: "round-won",
  ROUND_LOST: "round-lost",
  GAME_START: "game-start",
  YOUR_TURN: "your-turn",
  WIN: "win",
  LOSS: "loss",
  DRAW: "draw",
  LOW_TIME: "low-time",
  NOTIFY: "notify",
  ACHIEVEMENT: "achievement",
  LEVEL_UP: "level-up",
  CLICK: "click",
});

/**
 * @typedef {Object} Note
 * @property {number} at        seconds after the sound starts
 * @property {number} freq      starting pitch in Hz
 * @property {number} [to]      pitch to glide to by the end of the note
 * @property {number} dur       seconds, including the fade out
 * @property {"sine" | "triangle" | "square" | "sawtooth"} wave
 * @property {number} gain      peak loudness before the master volume, 0 to 1
 */

const note = (at, freq, dur, wave, gain, to) => Object.freeze({ at, freq, dur, wave, gain, to });

// Pitches of the notes used below, in Hz.
const C4 = 261.63;
const E4 = 329.63;
const G4 = 392;
const A4 = 440;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const B5 = 987.77;
const C6 = 1046.5;
const E6 = 1318.51;
const G6 = 1567.98;

/**
 * The notes of each sound. Loudness is tuned by ear so that nothing is harsh: the board sounds are short and
 * soft because they happen often, the result and reward sounds are a little longer, and the click and the clock
 * tick are barely there. Square and sawtooth waves are kept quiet because they sound much louder than sine waves
 * at the same gain.
 *
 * @type {Readonly<Record<string, ReadonlyArray<Note>>>}
 */
export const RECIPES = Object.freeze({
  // A wooden "tock": a quick downward glide.
  [SOUNDS.MOVE]: Object.freeze([note(0, 520, 0.07, "triangle", 0.5, 340)]),
  // Heavier than a move: a low knock with a short bright edge on top.
  [SOUNDS.CAPTURE]: Object.freeze([
    note(0, 300, 0.11, "triangle", 0.6, 160),
    note(0, 900, 0.04, "square", 0.08, 500),
  ]),
  // Two notes falling, like a small warning bell.
  [SOUNDS.CHECK]: Object.freeze([note(0, A5, 0.12, "sine", 0.35), note(0.1, E5, 0.16, "sine", 0.3)]),
  // King and rook: two tocks close together.
  [SOUNDS.CASTLE]: Object.freeze([
    note(0, 520, 0.06, "triangle", 0.45, 360),
    note(0.09, 470, 0.07, "triangle", 0.45, 320),
  ]),
  // A soft pop as a mark lands on the grid.
  [SOUNDS.PLACE]: Object.freeze([note(0, 600, 0.06, "sine", 0.4, 900)]),
  // Three quick rising notes as the winning line lights up.
  [SOUNDS.LINE]: Object.freeze([
    note(0, E5, 0.08, "triangle", 0.3),
    note(0.07, G5, 0.08, "triangle", 0.3),
    note(0.14, C6, 0.12, "triangle", 0.3),
  ]),
  // The hands open: an upward swish.
  [SOUNDS.REVEAL]: Object.freeze([note(0, 300, 0.14, "sine", 0.35, 900)]),
  [SOUNDS.ROUND_WON]: Object.freeze([
    note(0, C5, 0.09, "triangle", 0.3),
    note(0.08, G5, 0.14, "triangle", 0.3),
  ]),
  [SOUNDS.ROUND_LOST]: Object.freeze([note(0, E4, 0.1, "sine", 0.3), note(0.09, C4, 0.16, "sine", 0.3)]),
  // A bright rising chord to say "go".
  [SOUNDS.GAME_START]: Object.freeze([
    note(0, C5, 0.1, "triangle", 0.3),
    note(0.08, E5, 0.1, "triangle", 0.3),
    note(0.16, G5, 0.18, "triangle", 0.3),
  ]),
  // Gentle, for when the tab is in the background and it is your move.
  [SOUNDS.YOUR_TURN]: Object.freeze([note(0, E5, 0.12, "sine", 0.3), note(0.12, A5, 0.2, "sine", 0.3)]),
  [SOUNDS.WIN]: Object.freeze([
    note(0, C5, 0.12, "triangle", 0.3),
    note(0.1, E5, 0.12, "triangle", 0.3),
    note(0.2, G5, 0.12, "triangle", 0.3),
    note(0.3, C6, 0.35, "triangle", 0.32),
  ]),
  [SOUNDS.LOSS]: Object.freeze([
    note(0, G4, 0.16, "sine", 0.3),
    note(0.15, E4, 0.16, "sine", 0.3),
    note(0.3, C4, 0.4, "sine", 0.3),
  ]),
  [SOUNDS.DRAW]: Object.freeze([note(0, A4, 0.16, "sine", 0.3), note(0.16, A4, 0.26, "sine", 0.26)]),
  // The clock is running out: a tiny, high tick once a second.
  [SOUNDS.LOW_TIME]: Object.freeze([note(0, 1500, 0.035, "sine", 0.2)]),
  // Someone wants an answer (draw offer, rematch): a two-note chime.
  [SOUNDS.NOTIFY]: Object.freeze([note(0, B5, 0.18, "sine", 0.3), note(0.11, E6, 0.28, "sine", 0.24)]),
  [SOUNDS.ACHIEVEMENT]: Object.freeze([
    note(0, C6, 0.08, "sine", 0.25),
    note(0.06, E6, 0.08, "sine", 0.25),
    note(0.12, G6, 0.2, "sine", 0.25),
  ]),
  [SOUNDS.LEVEL_UP]: Object.freeze([
    note(0, C5, 0.1, "triangle", 0.28),
    note(0.08, E5, 0.1, "triangle", 0.28),
    note(0.16, G5, 0.1, "triangle", 0.28),
    note(0.24, C6, 0.4, "triangle", 0.3),
    note(0.24, E6, 0.4, "sine", 0.16),
  ]),
  // Buttons: barely audible, so it never gets in the way.
  [SOUNDS.CLICK]: Object.freeze([note(0, 1200, 0.02, "triangle", 0.12)]),
});
