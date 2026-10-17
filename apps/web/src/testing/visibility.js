/**
 * Lets a test put the page in the background and bring it back, like switching browser tabs. jsdom always says the
 * page is visible, so `document.hidden` and `document.visibilityState` are replaced while a test runs, and
 * `restoreVisibility` puts the real ones back.
 */
export function installVisibility({ hidden = false } = {}) {
  let value = hidden;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (value ? "hidden" : "visible"),
  });
  return {
    /** @param {boolean} next */
    setHidden(next) {
      value = next;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

export function restoreVisibility() {
  delete document.hidden;
  delete document.visibilityState;
}
