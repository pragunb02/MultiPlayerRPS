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
  return cleaned.length >= MIN ? cleaned : `${cleaned}_player`;
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
