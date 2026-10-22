/**
 * Put on the page's root element while the player's last press was a key, and taken off by a click or a touch
 * (CC-100). global.css draws the focus ring on an element focused in code (`tabindex="-1"`) only while it is there.
 */
export const KEYBOARD_CLASS = "using-keyboard";

/**
 * Follows whether the player is using the keyboard. Browsers decide `:focus-visible` for focus moved in code by
 * themselves, and they differ: Chromium draws the ring for a heading focused on page load, before any press, and
 * Firefox draws none for a heading focused after a key press. This gives the app one answer in every browser. Before
 * any press the player is not using the keyboard, so a page that focuses its heading on load draws no ring.
 *
 * Listens in the capture phase, so a key or a click is noted before the code it starts moves the focus.
 *
 * @param {Document} document
 * @returns {() => void} stops following
 */
export function followInputModality(document) {
  const root = document.documentElement;
  const keyboard = () => root.classList.add(KEYBOARD_CLASS);
  const pointer = () => root.classList.remove(KEYBOARD_CLASS);
  document.addEventListener("keydown", keyboard, true);
  document.addEventListener("pointerdown", pointer, true);
  return () => {
    document.removeEventListener("keydown", keyboard, true);
    document.removeEventListener("pointerdown", pointer, true);
    pointer();
  };
}
