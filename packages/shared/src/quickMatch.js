/**
 * Quick match (CC-051, ADR-079): the main Play button looks for a person while the computer character's game is
 * made ready. These are the words and numbers the server and the web app share.
 */

/** How one quick match search ended. Every search ends exactly one of these ways. */
export const QUICK_MATCH_OUTCOMES = Object.freeze({
  /** A person searching the same game was found, and the game with them has started. */
  PERSON: "person",
  /** Nobody was free in time, or the site was empty, so the game against the computer character has started. */
  CHARACTER: "character",
  /** The player cancelled, left or hid the page, or started a newer search. No game was started. */
  CANCELLED: "cancelled",
});

/**
 * The quick match rules as numbers (ADR-079). Each is a business rule: changing one is a one-line change with a
 * test (ADR-029.5).
 *
 * 1. `searchMs`: the longest a search looks for a person (ADR-029: at most 4 s).
 * 2. `chessTimeControl`: quick match chess has one pool, 3+2 (ADR-051.6).
 */
export const QUICK_MATCH_RULES = Object.freeze({
  searchMs: 4_000,
  chessTimeControl: "blitz-3+2",
});
