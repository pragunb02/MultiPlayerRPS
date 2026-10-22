/**
 * The switch that turns usage counts off in this browser (CC-174, ADR-034.3), and the signals that do the same
 * without it. Nothing records that a player turned it off: the key holds only `off`, and turning counts back on
 * removes it.
 */

/** The one web storage key of the switch. It is never sent to us. */
export const TELEMETRY_STORAGE_KEY = "cc.telemetry";
/** The only value it holds. */
export const TELEMETRY_OFF = "off";

/** Hosts of a laptop or a browser test, which never count (EVENTS.md 1.7). */
const LOCAL_HOSTS = Object.freeze(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * @typedef {Object} OptOutSources
 * @property {() => Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined} getStorage  web storage, or
 *   undefined when the browser refuses it
 * @property {Pick<Navigator, "doNotTrack" | "webdriver"> & { globalPrivacyControl?: boolean }} navigator
 * @property {{ hostname: string }} location
 */

function storageOf(getStorage) {
  try {
    return getStorage();
  } catch {
    return undefined;
  }
}

/**
 * Whether the player turned counts off on this browser with the switch.
 *
 * @param {OptOutSources["getStorage"]} getStorage
 * @returns {boolean}
 */
export function isSwitchedOff(getStorage) {
  try {
    const storage = storageOf(getStorage);
    // A browser that cannot keep the switch could never turn counts off with it, so it counts as off.
    return storage === undefined || storage.getItem(TELEMETRY_STORAGE_KEY) === TELEMETRY_OFF;
  } catch {
    return true;
  }
}

/**
 * Whether nothing may be counted here: the switch is off, the browser sends Global Privacy Control or Do Not
 * Track, it is driven by a browser test, or the page is on a laptop (EVENTS.md 1.6 and 1.7).
 *
 * @param {OptOutSources} sources
 * @returns {boolean}
 */
export function isTelemetryOff({ getStorage, navigator, location }) {
  return (
    navigator.globalPrivacyControl === true ||
    navigator.doNotTrack === "1" ||
    navigator.webdriver === true ||
    LOCAL_HOSTS.includes(location.hostname) ||
    isSwitchedOff(getStorage)
  );
}

/**
 * Turns counts off or back on for this browser.
 *
 * @param {OptOutSources["getStorage"]} getStorage
 * @param {boolean} off
 * @returns {boolean} whether it was saved
 */
export function setSwitchedOff(getStorage, off) {
  try {
    const storage = storageOf(getStorage);
    if (storage === undefined) return false;
    if (off) storage.setItem(TELEMETRY_STORAGE_KEY, TELEMETRY_OFF);
    else storage.removeItem(TELEMETRY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
