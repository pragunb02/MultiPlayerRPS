/**
 * What connects the one `EffectHost` to everything else, in memory only (CC-328): `play` reaches the host, the host
 * says which theme is on for `useEventTheme`, and the console's preview says which theme this tab shows. Nothing
 * here is ever stored, so a reload clears a preview. It is on the first route, so it imports nothing, not even the
 * registry, which comes with the host's own chunk.
 */

/** @type {((name: string, options: object) => Promise<boolean>) | undefined} */
let host;
/** @type {{ name: string, greeting: { hi: string, en: string } } | undefined} */
let theme;
/** @type {string | undefined} */
let preview;
const listeners = new Set();
const changed = () => listeners.forEach((listener) => listener());

/** @param {() => void} listener */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The theme on in this tab, as `{ name, greeting }`, or undefined. */
export const currentTheme = () => theme;

/** The theme the owner previews in this tab, or undefined. */
export const currentPreview = () => preview;

/**
 * Says which theme is on, with its greeting. The host calls it; nothing else does.
 *
 * @param {{ name: string, greeting: { hi: string, en: string } } | undefined} next
 */
export function showTheme(next) {
  if (next?.name === theme?.name) return;
  theme = next;
  changed();
}

/**
 * Shows a theme in this tab only, ignoring its flag and its window, until the tab reloads (the console's
 * "Preview in this tab"). `undefined` ends the preview.
 *
 * @param {string | undefined} name  a theme of the registry
 */
export function previewTheme(name) {
  preview = name;
  changed();
}

/** Whether a host takes plays now. */
export const hostReady = () => host !== undefined;

/**
 * Runs `callback` when the browser is idle, or as soon as it can where it cannot say. Returns the cancel.
 *
 * @param {() => void} callback
 */
export function whenIdle(callback) {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(callback, { timeout: 2000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
}

/**
 * The host takes the plays. Returns the function that lets go, for when it unmounts.
 *
 * @param {(name: string, options: object) => Promise<boolean>} play
 */
export function attachHost(play) {
  host = play;
  return () => {
    if (host === play) host = undefined;
  };
}

/**
 * Asks the host to play an effect. Resolves when it ended (`true`) or was dropped (`false`): an effect is
 * decoration, and the result is already in words on the page. With no host mounted yet it is dropped. It rejects
 * only for a name that is not in the registry, which is a mistake in code.
 *
 * @param {string} name  an entry of the registry
 * @param {{ origin?: { x: number, y: number, width?: number } }} [options]  where it starts, in CSS pixels of the
 *   viewport: a point, or a box whose top corners a burst comes from
 * @returns {Promise<boolean>}
 */
export const play = (name, options = {}) => (host ? host(name, options) : Promise.resolve(false));
