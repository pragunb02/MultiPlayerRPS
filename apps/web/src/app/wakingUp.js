/** Put on the page's root element when the waking up screen was already on screen as the app started (CC-232). */
export const WAITED_CLASS = "wake-waited";

/** Put on the page's root element when the screen's "still waking up" line was on screen too (CC-232). */
export const WAITED_LONG_CLASS = "wake-waited-long";

/**
 * Notes whether the screen in index.html, and its later "still waking up" line, were visible when the app started.
 * Each shows only after a delay, so on a fast load neither was. Whatever the player already saw, the app's own
 * copy of the screen must show at once instead of disappearing for that delay and coming back. Call it before the
 * first render, which removes the screen.
 *
 * @param {{ document: Document, window: Pick<Window, "getComputedStyle"> }} options
 * @returns {boolean} whether the player had seen the screen
 */
export function noteWaitingScreen({ document, window }) {
  const shown = (element) => element !== null && window.getComputedStyle(element).visibility === "visible";
  const seen = shown(document.querySelector('[data-wake="page"]'));
  if (seen) {
    document.documentElement.classList.add(WAITED_CLASS);
  }
  if (seen && shown(document.querySelector('[data-wake="page"] .wake-later'))) {
    document.documentElement.classList.add(WAITED_LONG_CLASS);
  }
  return seen;
}
