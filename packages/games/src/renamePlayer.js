/**
 * Replaces a player id everywhere in a game's state — as a value and as an object key — and returns a new value.
 * Used when a guest signs in mid-game and their seat becomes their account's (CC-083). Safe because engine state
 * is plain JSON (a contract check) and player ids are unique, unguessable strings, so an id can't collide with any
 * other value. Every engine must keep working after a rename: the contract kit plays a game with one.
 *
 * @template T
 * @param {T} value  engine state, a match log, any plain JSON
 * @param {string} from
 * @param {string} to
 * @returns {T}
 */
export function renamePlayer(value, from, to) {
  if (value === from) {
    return /** @type {T} */ (to);
  }
  if (Array.isArray(value)) {
    return /** @type {T} */ (value.map((item) => renamePlayer(item, from, to)));
  }
  if (value !== null && typeof value === "object") {
    return /** @type {T} */ (
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key === from ? to : key, renamePlayer(item, from, to)]),
      )
    );
  }
  return value;
}
