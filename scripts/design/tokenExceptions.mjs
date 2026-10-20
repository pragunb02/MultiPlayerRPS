/**
 * The raw values the CSS token check lets through (CC-314). Each entry is one property in one file, with the reason.
 * This list may only shrink. docs/design/CONTRACT.md lists the same entries, and scripts/cssTokens.test.mjs fails
 * when the two differ or when the list grows past its ceiling, so a new exception needs a contract change first.
 */

const exception = (file, property, reason) => Object.freeze({ file, property, reason });

export const TOKEN_EXCEPTIONS = Object.freeze([
  exception(
    "apps/web/src/art/effects/effects.module.css",
    "border-radius",
    "A confetti piece's 2px corner is part of the drawing, not a control's radius.",
  ),
  exception(
    "apps/web/src/art/effects/effects.module.css",
    "--drift",
    "Each confetti piece's sideways drift, in pixels, is part of the drawing.",
  ),
  exception(
    "apps/web/src/components/Toast/Toast.module.css",
    "border-radius",
    "The toast's small diamond gem has a 3px corner, smaller than any control radius.",
  ),
  exception(
    "apps/web/src/games/chess/ChessBoard.module.css",
    "margin-right",
    "Captured pieces overlap by a fixed part of their own 1.25rem size.",
  ),
  exception(
    "apps/web/src/games/chess/Board.module.css",
    "padding",
    "The board's coordinates sit a fixed distance in from the square's corner, at every board size.",
  ),
]);

/** The most entries the list may have. Lower it when an entry goes. Never raise it without the contract. */
export const TOKEN_EXCEPTIONS_CEILING = 5;
