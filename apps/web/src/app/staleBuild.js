/** Added to the address by a reload for a newer version of the site, so the next page knows it came from one. */
export const RELOADED_PARAM = "reloaded";

/**
 * How long after such a reload another failed load shows the error page instead of reloading again. A file that is
 * still missing right after a reload is not an old tab's problem, and reloading again would never end. A failure
 * later on is a newer deploy, which deserves its own reload.
 */
export const RELOAD_GUARD_MS = 30_000;

/** Vite tells the page through this event when a file of a lazily loaded part, such as a game board, failed. */
const PRELOAD_ERROR = "vite:preloadError";

const pathOf = (url) => `${url.pathname}${url.search}${url.hash}`;

/**
 * Recovers a tab that was opened before a deploy (CC-181). Such a tab still asks for the files of its own version
 * when it opens a game board, and those are gone, so loading the board fails. The tab then reloads once, which gets
 * it the new version, and the player lands back where they were. Without this the whole app would be replaced by
 * "Something went wrong".
 *
 * The reload marks the address. The next page removes the mark at once, before the router reads the address, and
 * remembers it only in memory. Nothing is kept in web storage. While a reload is under way the failure is
 * swallowed, so the board keeps showing its loading state instead of the error page.
 *
 * Call it first in the browser entry point.
 *
 * @param {{
 *   window: Pick<Window, "location" | "history" | "addEventListener" | "removeEventListener">,
 *   now: () => number,
 * }} deps
 * @returns {() => void} stops listening
 */
export function recoverFromStaleBuild({ window, now }) {
  const address = new URL(window.location.href);
  const cameFromReload = address.searchParams.has(RELOADED_PARAM);
  if (cameFromReload) {
    address.searchParams.delete(RELOADED_PARAM);
    window.history.replaceState(window.history.state, "", pathOf(address));
  }
  const startedAt = now();
  let reloading = false;

  /** @param {Event} event */
  function onPreloadError(event) {
    if (!reloading && cameFromReload && now() - startedAt < RELOAD_GUARD_MS) {
      return;
    }
    event.preventDefault();
    if (reloading) {
      return;
    }
    reloading = true;
    const marked = new URL(window.location.href);
    marked.searchParams.set(RELOADED_PARAM, "1");
    // Replacing the address keeps the history entry and its state, so Back still works after the reload.
    window.history.replaceState(window.history.state, "", pathOf(marked));
    window.location.reload();
  }

  window.addEventListener(PRELOAD_ERROR, onPreloadError);
  return () => window.removeEventListener(PRELOAD_ERROR, onPreloadError);
}
