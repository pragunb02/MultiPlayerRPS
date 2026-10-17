import { isOffensiveName, isReservedName } from "./publicName.js";

const MIN = 3;
const MAX = 20;

/**
 * Turns a legacy username (never validated by the old app — spaces, symbols, any length) into one that meets
 * today's rules (3–20 of `[A-Za-z0-9_]`), keeping it recognisable: invalid characters become `_`, runs collapse,
 * short names are padded, long ones cut.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normaliseLegacyUsername(raw) {
  const cleaned = String(raw ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, MAX);
  // Too short after cleaning (at most 2 characters left): pad to a readable valid name, e.g. "a" → "a_player".
  const name = cleaned.length >= MIN ? cleaned : `${cleaned}_player`;
  // The old app never checked names, so a reserved or rude one is swapped for a neutral one (CC-119).
  return isReservedName(name) || isOffensiveName(name) ? fallbackUsername(name) : name;
}

/**
 * A neutral name such as `Player_4821`. The number comes from the old name, so the same player gets the same
 * name every time their account is created again after a failed attempt.
 *
 * @param {string} seed
 */
function fallbackUsername(seed) {
  let hash = 2166136261;
  for (const char of seed) {
    hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
  }
  return `Player_${1000 + (hash % 9000)}`;
}

/**
 * Candidates to try, in order, when the normalised name is already taken: `name`, `name_2`, `name_3` … (still ≤ 20).
 *
 * @param {string} base  a normalised username
 * @param {number} count
 */
export function usernameCandidates(base, count) {
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return base;
    const suffix = `_${i + 1}`;
    return `${base.slice(0, MAX - suffix.length)}${suffix}`;
  });
}
