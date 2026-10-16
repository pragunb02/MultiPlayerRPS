/**
 * Progression rules, shared so the web app shows exactly what the server awards.
 * XP is earned per recorded match; leaving a game in progress (forfeit) earns nothing.
 */
export const XP_AWARDS = Object.freeze({ win: 30, draw: 15, loss: 10, forfeit: 0 });

const XP_STEP = 50;
export const MAX_LEVEL = 100;

/**
 * Total XP needed to reach `level` (level 1 = 0 XP). Each level needs 50 XP more than the last:
 * 1 → 0, 2 → 50, 3 → 150, 4 → 300, 5 → 500 …
 *
 * @param {number} level
 */
export function xpForLevel(level) {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    throw new RangeError(`level must be an integer from 1 to ${MAX_LEVEL}`);
  }
  return (XP_STEP * (level - 1) * level) / 2;
}

/**
 * @param {number} xp  total XP (non-negative integer)
 * @returns {number} the level reached with that much XP
 */
export function levelForXp(xp) {
  if (!Number.isInteger(xp) || xp < 0) {
    throw new RangeError("xp must be a non-negative integer");
  }
  let level = 1;
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= xp) {
    level++;
  }
  return level;
}
