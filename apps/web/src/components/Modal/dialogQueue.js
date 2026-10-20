/**
 * The order in which dialogs asked to open (CC-314). The design contract allows one open dialog at a time, so the
 * first in the queue is shown and the others wait their turn. A dialog leaves the queue when it closes or unmounts.
 */
const waiting = [];
const listeners = new Set();

const changed = () => {
  for (const listener of listeners) listener();
};

export const dialogQueue = Object.freeze({
  /** @param {string} id */
  join(id) {
    if (waiting.includes(id)) return;
    waiting.push(id);
    changed();
  },
  /** @param {string} id */
  leave(id) {
    const at = waiting.indexOf(id);
    if (at === -1) return;
    waiting.splice(at, 1);
    changed();
  },
  /** @param {() => void} listener  @returns {() => void} a function that stops listening */
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** @returns {string} the dialog shown now, or an empty string when none asked */
  front: () => waiting[0] ?? "",
});
