/**
 * Contract checks for wiring-time dependencies: a mistake fails at boot, not at first request.
 */

/**
 * @param {unknown} value
 * @param {string} name
 */
export function assertDefined(value, name) {
  if (value === undefined || value === null) {
    throw new TypeError(`${name} is required`);
  }
}

/**
 * @param {unknown} value
 * @param {string} name
 */
export function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}
