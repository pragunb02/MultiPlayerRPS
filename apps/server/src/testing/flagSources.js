// How code names a feature flag (CC-312): by a quoted string in a call to one of these. A name built at run time
// is not found here, which is why flags are always written out in full.
const READS = /\b(?:isOn|useFlag|recordSuccess)\(\s*["']([a-z0-9_]+)["']/g;
const PATHS = /\bflagPaths\(\s*["']([a-z0-9_]+)["']/g;

const namesOf = (pattern, text) => [...text.matchAll(pattern)].map((match) => match[1]);

/**
 * The flag names a source file reads.
 *
 * @param {string} text
 * @returns {string[]}
 */
export const flagNamesIn = (text) => namesOf(READS, text);

/**
 * The flags a test file runs on and off with `flagPaths`.
 *
 * @param {string} text
 * @returns {string[]}
 */
export const flagPathsIn = (text) => namesOf(PATHS, text);
