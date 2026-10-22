/**
 * @typedef {Object} HowToPlayStep
 * @property {import("react").ComponentType} Glyph  a 64 x 64 glyph drawn beside the words, as decoration
 * @property {string} text                           one short sentence
 * @property {string} hinglish                       the same sentence in Hinglish, with "tum", for the pages that
 *   speak Hinglish (CC-217, CC-349)
 */

/**
 * One step of a game's How to play. Each game keeps its steps in its own folder, loaded on demand through its
 * registry entry's `loadHowToPlay` (CC-349), so they download with the pages that show them.
 *
 * @param {import("react").ComponentType} Glyph
 * @param {string} text
 * @param {string} hinglish
 * @returns {Readonly<HowToPlayStep>}
 */
export const step = (Glyph, text, hinglish) => Object.freeze({ Glyph, text, hinglish });

/**
 * The most a game's How to play may hold (check A2 of the clarity audit, CC-349): three steps, each shorter than 90
 * characters, so the steps read at a glance in the lobby, on an invite and in the game's dialog.
 */
export const HOW_TO_PLAY_LIMITS = Object.freeze({ steps: 3, characters: 90 });

/**
 * @param {ReadonlyArray<unknown>} steps
 * @returns {string} "3 steps", or "1 step", for the line "How to play: 3 steps"
 */
export const stepCount = (steps) => `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
