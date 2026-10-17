/** Put on the page's root element when the waking up screen was already on screen as the app started (CC-232). */
export const WAITED_CLASS = "wake-waited";

/**
 * Notes whether the screen in index.html was visible when the app started. It shows only after a short delay, so on
 * a fast load it was not. When it was, the player is already waiting, and the app's own copy of the screen must show
 * at once instead of disappearing for that delay and coming back. Call it before the first render, which removes
 * the screen.
 *
 * @param {{ document: Document, window: Pick<Window, "getComputedStyle"> }} options
 * @returns {boolean} whether the player had seen the screen
 */
export function noteWaitingScreen({ document, window }) {
  const screen = document.querySelector('[data-wake="page"]');
  const seen = screen !== null && window.getComputedStyle(screen).visibility === "visible";
  if (seen) {
    document.documentElement.classList.add(WAITED_CLASS);
  }
  return seen;
}
