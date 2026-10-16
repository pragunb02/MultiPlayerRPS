import { MAX_LEVEL } from "@classicade/shared";

/**
 * @typedef {Object} Rank
 * @property {string} name        shown to players ("Pro")
 * @property {number} minLevel    first level of the band
 * @property {number} maxLevel    last level of the band
 * @property {"bronze" | "silver" | "gold" | "platinum"} tier   badge colour
 * @property {boolean} glow       Master and up shine
 * @property {boolean} ring       Legend gets a platinum ring around the gold badge
 */

/**
 * Rank names by level band (ADR-012): a name feels like status in a way a number does not. Bands cover every
 * level from 1 to MAX_LEVEL with no gaps.
 *
 * @type {ReadonlyArray<Readonly<Rank>>}
 */
export const RANKS = Object.freeze(
  [
    { name: "Rookie", minLevel: 1, maxLevel: 4, tier: "bronze", glow: false, ring: false },
    { name: "Challenger", minLevel: 5, maxLevel: 9, tier: "silver", glow: false, ring: false },
    { name: "Pro", minLevel: 10, maxLevel: 19, tier: "gold", glow: false, ring: false },
    { name: "Elite", minLevel: 20, maxLevel: 34, tier: "platinum", glow: false, ring: false },
    { name: "Master", minLevel: 35, maxLevel: 49, tier: "platinum", glow: true, ring: false },
    { name: "Legend", minLevel: 50, maxLevel: MAX_LEVEL, tier: "gold", glow: true, ring: true },
  ].map((rank) => Object.freeze(rank)),
);

/**
 * The rank for a level.
 *
 * @param {number} level  an integer from 1 to MAX_LEVEL
 * @returns {Readonly<Rank>}
 * @throws {RangeError} for anything else — a level outside the rules is a bug upstream, not a rank
 */
export function rankForLevel(level) {
  const rank = RANKS.find((r) => Number.isInteger(level) && level >= r.minLevel && level <= r.maxLevel);
  if (rank === undefined) {
    throw new RangeError(`level must be an integer from 1 to ${MAX_LEVEL}, got ${level}`);
  }
  return rank;
}
