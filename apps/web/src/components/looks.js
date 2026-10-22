/**
 * The choices the shared components offer (CC-323, docs/design/CONTRACT.md). They live apart from the components so
 * the design page and the tests can list them, and each component refuses anything else.
 */

/** The looks of a button. One primary per region: a page, a dialog, a card or a sheet. */
export const BUTTON_VARIANTS = Object.freeze(["primary", "accent", "secondary", "ghost", "danger"]);

/** The sizes of a button. Every size is at least 24 px tall, and 44 px on a touch screen (WCAG 2.5.8 and our rule). */
export const BUTTON_SIZES = Object.freeze(["sm", "md", "lg"]);

/** The card looks. A game tone marks that game. A brand or gold accent marks the one featured card of a screen. */
export const CARD_VARIANTS = Object.freeze(["surface", "raised", "accent", "notice"]);

/** The colour along an accent card's top edge: a game's own colour, the brand, or gold for a reward. */
export const ACCENT_TONES = Object.freeze(["primary", "rps", "tictactoe", "chess", "gold"]);

/** The meaning of a notice card. Each comes with its words, never colour alone. */
export const NOTICE_TONES = Object.freeze(["info", "success", "warning", "danger"]);

/** The kinds of form field. Each has the same label, hint, error and character count. */
export const FIELD_KINDS = Object.freeze(["text", "select", "textarea", "date", "copy"]);

/** The shapes a skeleton can take, each the height of the thing it stands in for, so nothing moves when it comes. */
export const SKELETON_SHAPES = Object.freeze(["line", "row", "tile", "card", "board", "block"]);

/**
 * The words of a field's character count.
 *
 * @param {number} length  the characters typed
 * @param {number} max  the most allowed
 * @returns {string} such as "12 of 500 characters"
 */
export const countText = (length, max) => `${length} of ${max} characters`;
