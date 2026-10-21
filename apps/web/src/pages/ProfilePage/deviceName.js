/** What the server says when it could not tell the browser or the system (CC-262). */
const UNKNOWN = "Unknown";

/**
 * A device in words, such as "Chrome on Android", from the coarse browser and system the server read at sign-in
 * (CC-262).
 *
 * @param {{ browser: string, system: string }} device
 * @returns {string}
 */
export function deviceName({ browser, system }) {
  if (system === UNKNOWN) {
    return browser === UNKNOWN ? "Unknown device" : browser;
  }
  return `${browser === UNKNOWN ? "A browser" : browser} on ${system}`;
}
