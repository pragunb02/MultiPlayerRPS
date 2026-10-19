import { SOUNDS } from "../sound/sounds.js";

/**
 * Every kind of notice the app gives (CC-208). Each category has its own sound, its own place on screen, a
 * priority and a rate limit, and the player can set its volume or turn its sound off in the sound settings. A
 * notice is never sound alone: its words are always on screen and read out by screen readers.
 *
 * 1. `place` says where the words show: the request banner at the top of a room or of any page, the board and
 *    the tab title, the result card, the toasts at the bottom, or the banner under the header.
 * 2. `priority` decides who waits: while something of a higher priority is on screen, toasts of a lower one wait
 *    their turn. A request therefore goes ahead of rewards, and a lost connection ahead of everything.
 * 3. `minGapMs` is the rate limit: the category's sound plays at most once in that time, and the same toast is not
 *    shown twice in it.
 *
 * @typedef {Object} NotificationCategory
 * @property {string} id
 * @property {string} label       the name in the sound settings
 * @property {string} sound       its own sound, an id from SOUNDS
 * @property {"banner" | "board" | "result" | "toast" | "connection"} place
 * @property {number} priority    higher goes first
 * @property {number} minGapMs
 */

export const CATEGORIES = Object.freeze({
  REQUEST: "request",
  TURN: "turn",
  RESULT: "result",
  REWARD: "reward",
  SOCIAL: "social",
  SYSTEM: "system",
});

/** @type {ReadonlyArray<Readonly<NotificationCategory>>} in the order the settings list them */
export const NOTIFICATION_CATEGORIES = Object.freeze(
  [
    {
      id: CATEGORIES.REQUEST,
      label: "Requests (rematch, draw offer)",
      sound: SOUNDS.NOTIFY,
      place: "banner",
      priority: 4,
      minGapMs: 2_000,
    },
    {
      id: CATEGORIES.TURN,
      label: "Moves and your turn",
      sound: SOUNDS.YOUR_TURN,
      place: "board",
      priority: 2,
      minGapMs: 0,
    },
    { id: CATEGORIES.RESULT, label: "Results", sound: SOUNDS.WIN, place: "result", priority: 3, minGapMs: 0 },
    {
      id: CATEGORIES.REWARD,
      label: "Rewards (XP, levels, achievements)",
      sound: SOUNDS.ACHIEVEMENT,
      place: "toast",
      priority: 1,
      minGapMs: 1_000,
    },
    {
      id: CATEGORIES.SOCIAL,
      label: "Other players (joined, away, back)",
      sound: SOUNDS.PRESENCE,
      place: "toast",
      priority: 2,
      minGapMs: 3_000,
    },
    {
      id: CATEGORIES.SYSTEM,
      label: "Connection and notices",
      sound: SOUNDS.CONNECTION,
      place: "connection",
      priority: 5,
      minGapMs: 5_000,
    },
  ].map((category) => Object.freeze(category)),
);

/**
 * The category of every sound, so its volume and on or off setting apply. The click of a button is not a notice:
 * it has no category and follows only the main volume.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SOUND_CATEGORIES = Object.freeze({
  [SOUNDS.MOVE]: CATEGORIES.TURN,
  [SOUNDS.CAPTURE]: CATEGORIES.TURN,
  [SOUNDS.CHECK]: CATEGORIES.TURN,
  [SOUNDS.CASTLE]: CATEGORIES.TURN,
  [SOUNDS.PLACE]: CATEGORIES.TURN,
  [SOUNDS.LINE]: CATEGORIES.TURN,
  [SOUNDS.REVEAL]: CATEGORIES.TURN,
  [SOUNDS.ROUND_WON]: CATEGORIES.TURN,
  [SOUNDS.ROUND_LOST]: CATEGORIES.TURN,
  [SOUNDS.GAME_START]: CATEGORIES.TURN,
  [SOUNDS.YOUR_TURN]: CATEGORIES.TURN,
  [SOUNDS.LOW_TIME]: CATEGORIES.TURN,
  [SOUNDS.WIN]: CATEGORIES.RESULT,
  [SOUNDS.LOSS]: CATEGORIES.RESULT,
  [SOUNDS.DRAW]: CATEGORIES.RESULT,
  [SOUNDS.WIN_QUIET]: CATEGORIES.RESULT,
  [SOUNDS.GAME_VOID]: CATEGORIES.RESULT,
  [SOUNDS.NOTIFY]: CATEGORIES.REQUEST,
  [SOUNDS.ACHIEVEMENT]: CATEGORIES.REWARD,
  [SOUNDS.LEVEL_UP]: CATEGORIES.REWARD,
  [SOUNDS.PRESENCE]: CATEGORIES.SOCIAL,
  [SOUNDS.CONNECTION]: CATEGORIES.SYSTEM,
});

/**
 * A category by its id.
 *
 * @param {string} id
 * @returns {Readonly<NotificationCategory>}
 * @throws {Error} for an id that is not a category (a programming mistake)
 */
export function categoryOf(id) {
  const category = NOTIFICATION_CATEGORIES.find((each) => each.id === id);
  if (category === undefined) {
    throw new Error(`Unknown notification category: ${id}`);
  }
  return category;
}
