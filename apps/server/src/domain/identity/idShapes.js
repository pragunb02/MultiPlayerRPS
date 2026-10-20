import { hasPlayerIdShape } from "../../models/playerIdShape.js";

/**
 * `value` with every string shaped like a player id replaced by `rename` of it, as a value or as a key, at any depth.
 * Views that name players by a keyed id use it as their last check after renaming the players they know about, so a
 * player id in a field nobody listed is still never sent (CC-253, CC-297, ADR-057).
 *
 * @template T
 * @param {T} value  plain JSON
 * @param {(playerId: string) => string} rename
 * @returns {T}
 */
export function renameIdShapes(value, rename) {
  const named = (text) => (hasPlayerIdShape(text) ? rename(text) : text);
  if (typeof value === "string") return /** @type {T} */ (named(value));
  if (Array.isArray(value)) return /** @type {T} */ (value.map((item) => renameIdShapes(item, rename)));
  if (value !== null && typeof value === "object") {
    return /** @type {T} */ (
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [named(key), renameIdShapes(item, rename)]),
      )
    );
  }
  return value;
}
