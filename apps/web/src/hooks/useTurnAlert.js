import { useEffect, useSyncExternalStore } from "react";

export const TURN_TITLE = "Your turn! · ClassiCade";
export const FAVICON = "/favicon.svg";
/** The same glyph with a badge, so a tab in a row of tabs still shows that something is waiting. */
export const FAVICON_ALERT = "/favicon-turn.svg";
const FLASH_MS = 1_000;

function subscribe(onChange) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const isHidden = () => document.hidden;

/** Whether this tab is in the background right now (another tab, a minimised window), following every change. */
export function useDocumentHidden() {
  return useSyncExternalStore(subscribe, isHidden);
}

const setFavicon = (href) => document.querySelector("link[rel='icon']")?.setAttribute("href", href);

/**
 * Calls the player back to a background tab when it is their move (CC-104): the tab title alternates between
 * "Your turn! · ClassiCade" and the page's own title once a second, and the favicon gets a badge. Everything is
 * put back the moment the tab is visible again or it stops being their turn.
 *
 * The page's title belongs to React (each page renders its own), so it is read when the alert starts and written
 * back when it stops. If the page changes its title while the alert runs, that new title is the one restored.
 *
 * @param {boolean} yourTurn
 */
export function useTurnAlert(yourTurn) {
  const hidden = useDocumentHidden();
  const active = yourTurn && hidden;

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let pageTitle = document.title;
    let showingAlert = true;
    document.title = TURN_TITLE;
    setFavicon(FAVICON_ALERT);
    const timer = setInterval(() => {
      if (document.title !== TURN_TITLE && document.title !== pageTitle) {
        pageTitle = document.title;
      }
      showingAlert = !showingAlert;
      document.title = showingAlert ? TURN_TITLE : pageTitle;
    }, FLASH_MS);
    return () => {
      clearInterval(timer);
      if (document.title === TURN_TITLE) {
        document.title = pageTitle;
      }
      setFavicon(FAVICON);
    };
  }, [active]);
}
