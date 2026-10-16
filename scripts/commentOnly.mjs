// Proves that a change only touched comments. Each file is turned into its code tokens with the comments left out,
// once before and once after the change. When the two lists are equal, the code did not change.
import { tokenize } from "espree";
import { stripCssComments } from "../eslint-rules/cssComments.mjs";

const JS = /\.(js|jsx|mjs|cjs)$/;

/**
 * Lists the code of a file without its comments or layout, so two versions can be compared.
 * @param {{ path: string, source: string }} file The file name decides how the source is read.
 * @returns {ReadonlyArray<string>} One entry per code token. CSS gives a single entry with the whitespace squeezed.
 */
export const codeTokens = ({ path, source }) => {
  if (path.endsWith(".css")) return Object.freeze([stripCssComments(source).replace(/\s+/g, " ").trim()]);
  const options = { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } };
  return Object.freeze(tokenize(source, options).map((token) => `${token.type} ${token.value}`));
};

/**
 * Says whether a file can be checked, which is true for JavaScript and CSS.
 * @param {string} path The file name.
 * @returns {boolean} True when `codeTokens` can read the file.
 */
export const isCheckable = (path) => JS.test(path) || path.endsWith(".css");

/**
 * Compares the code of each changed file before and after the change.
 * @param {ReadonlyArray<{ path: string, before: string, after: string }>} files The changed files with both versions.
 * @returns {ReadonlyArray<string>} The files whose code changed. Empty when only comments changed.
 */
export const filesWithCodeChanges = (files) =>
  Object.freeze(
    files
      .filter(({ path, before, after }) => {
        const old = codeTokens({ path, source: before });
        const now = codeTokens({ path, source: after });
        return old.length !== now.length || old.some((token, index) => token !== now[index]);
      })
      .map(({ path }) => path),
  );
