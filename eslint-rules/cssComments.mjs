import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROBLEMS, checkComment } from "./commentCheck.mjs";
import { COMMENT_STYLE_ON, globsFor } from "./commentStyleScope.mjs";

/**
 * @typedef {Object} CssProblem
 * @property {number} line The line of the problem, counted from 1.
 * @property {number} column The column of the problem, counted from 1.
 * @property {string} message What is wrong and what to write instead.
 */

/**
 * Finds the line and column of a position in a text.
 * @param {string} source The whole text.
 * @param {number} index The position, counted in characters from the start.
 * @returns {{ line: number, column: number }} Both counted from 1.
 */
const positionOf = (source, index) => {
  const before = source.slice(0, index).split("\n");
  return { line: before.length, column: before.at(-1).length + 1 };
};

/**
 * Finds quoted strings and comments in CSS. Only comments fill the first group. Strings are matched so that a `/*`
 * inside a quoted value is not taken for the start of a comment.
 * @returns {RegExp} A new global pattern, so callers never share its position.
 */
const cssStringsAndComments = () => /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\/\*([\s\S]*?)(?:\*\/|$)/g;

/**
 * Removes every comment from a CSS file and leaves the rest as it is.
 * @param {string} source The CSS file.
 * @returns {string} The CSS without comments.
 */
export const stripCssComments = (source) =>
  source.replace(cssStringsAndComments(), (match, comment) => (comment === undefined ? match : ""));

/**
 * Checks every `/* *\/` comment in a CSS file against the comment style rule.
 * @param {string} source The CSS file.
 * @returns {ReadonlyArray<CssProblem>} Every problem, in order. Empty when all comments are fine.
 */
export const checkCssComments = (source) => {
  const problems = [];
  for (const match of source.matchAll(cssStringsAndComments())) {
    const [, text] = match;
    if (text === undefined) continue;
    for (const problem of checkComment(text, { block: true })) {
      const message = problem.id === "jargon" ? `"${problem.found}" is jargon or shorthand. ` : "";
      problems.push({
        ...positionOf(source, match.index + 2 + problem.index),
        message: message + PROBLEMS[problem.id],
      });
    }
  }
  return Object.freeze(problems);
};

/**
 * Checks the CSS comments in every folder where the comment style rule is on.
 * @param {{ root: string, paths?: ReadonlyArray<string>, log: (line: string) => void }} options The repository
 *   root, the folders to check (all folders where the rule is on unless given) and where to write each problem.
 * @returns {number} How many problems were found, so the caller can fail the lint run.
 */
export const checkCssFiles = ({ root, paths = COMMENT_STYLE_ON, log }) => {
  const files = globSync(globsFor(paths, ["css"]), { cwd: root, exclude: (name) => name === "node_modules" });
  let count = 0;
  for (const file of [...files].sort()) {
    for (const { line, column, message } of checkCssComments(readFileSync(join(root, file), "utf8"))) {
      log(`${file}:${line}:${column}  ${message}  classicade/comment-style`);
      count += 1;
    }
  }
  return count;
};
