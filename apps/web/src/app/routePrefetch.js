/**
 * The moments a player shows they are about to open a link: the pointer comes over it, it gets keyboard focus, or a
 * finger touches it. A touch comes about a tenth of a second before the tap's click, a hover often much more.
 */
export const INTENT_EVENTS = Object.freeze(["pointerover", "focusin", "touchstart"]);

/**
 * Starts downloading a page as soon as a player shows they are about to open a link to it (CC-322), so the page is
 * usually here by the time the click lands and its skeleton never shows. One listener on the document covers every
 * link in the app, including links added later. Only links to this site count, and only the address's path is
 * passed on. Downloading twice changes nothing, because each page remembers its download.
 *
 * @param {{
 *   document: Pick<Document, "addEventListener" | "removeEventListener">,
 *   origin: string,
 *   preload: (pathname: string) => unknown,
 * }} deps  `origin` is the site's own, such as `window.location.origin`
 * @returns {() => void} stops listening
 */
export function prefetchOnIntent({ document, origin, preload }) {
  /** @param {Event} event */
  function onIntent(event) {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (link === null) {
      return;
    }
    // The browser has already resolved `href` against the page's address.
    const url = new URL(link.href);
    if (url.origin === origin) {
      preload(url.pathname);
    }
  }
  const options = { passive: true, capture: true };
  for (const type of INTENT_EVENTS) {
    document.addEventListener(type, onIntent, options);
  }
  return () => {
    for (const type of INTENT_EVENTS) {
      document.removeEventListener(type, onIntent, options);
    }
  };
}
