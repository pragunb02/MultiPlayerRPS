// The comment style rule from docs/ENGINEERING.md, item 14 of the coding standards, as a pure function.
// The ESLint rule and the CSS check both call it, so JavaScript and CSS comments follow the same wording rules.

/**
 * Comments that talk to a tool rather than to a person. Their wording is fixed by the tool, so they are not checked.
 */
const DIRECTIVE =
  /^\s*(eslint|eslint-disable|eslint-disable-next-line|eslint-disable-line|eslint-enable|eslint-env|global|globals|exported|prettier-ignore|v8 ignore|c8 ignore|istanbul ignore|@vite-ignore|@vitest-environment)(\s|$)/;

/**
 * Every kind of problem the check knows, with the advice shown to the author.
 * The `id` is what the ESLint rule uses as its message id.
 */
export const PROBLEMS = Object.freeze({
  arrow: "Write the step in words instead of an arrow.",
  doubleHyphen: "Do not use a double hyphen. Use a full stop, comma, colon or brackets instead.",
  hyphenBullet: "Write lists as numbered items or separate sentences, not hyphen bullets.",
  spacedHyphen: "Do not use a spaced hyphen as a dash. Use a full stop, comma, colon or brackets instead.",
  semicolon: "Do not use semicolons. Split the sentence or use a comma.",
  dash: "Do not use en or em dashes. Use a full stop, comma, colon or brackets instead.",
  jargon: "Avoid jargon and shorthand. Say what happens in plain words instead.",
});

/**
 * One pass over the cleaned text finds every problem. When two patterns could match at the same place, the
 * first group wins, so a `-->` arrow counts once as an arrow and not again as a double hyphen.
 * Two hyphens in front of a name, as in the CSS variable `--color-bg` or the flag `--watch`, are part of the name
 * and not punctuation, so only a double hyphen that is not followed by a letter or digit counts.
 */
const PATTERN = new RegExp(
  [
    String.raw`(?<arrow>-->|->|=>|<-|[→←↔⇒])`,
    String.raw`(?<doubleHyphen>--+(?![\w-]))`,
    String.raw`(?<hyphenBullet>^[ \t]*-(?=[ \t]))`,
    String.raw`(?<spacedHyphen>(?<=\S[ \t]+)-(?=[ \t]|$))`,
    String.raw`(?<semicolon>;)`,
    String.raw`(?<dash>[–—])`,
    String.raw`(?<jargon>\b(?:idempotent\w*|idempotency|upsert\w*|observer pattern|exactly-once|etc\b\.?|e\.g\.?|i\.e\.?)(?![a-z]))`,
  ].join("|"),
  "gimu",
);

/**
 * Replaces every character of a match with a space, but keeps line breaks.
 * The text keeps its length and its lines, so a position in the cleaned text is the same position in the original.
 * @param {string} text The text to clean.
 * @param {RegExp} pattern A global pattern for the parts to blank out.
 * @returns {string} The text with those parts blanked out.
 */
const blank = (text, pattern) => text.replace(pattern, (part) => part.replace(/[^\n]/g, " "));

/**
 * Blanks out every balanced `{ }` group, because those hold JSDoc types such as `{Object<string, number>}` or
 * `{{ a: string; b: number }}`. Types are code, so their punctuation is not prose.
 * @param {string} text The JSDoc comment text.
 * @returns {string} The text with every brace group blanked out.
 */
const blankBraces = (text) => {
  const chars = [...text];
  let depth = 0;
  let start = 0;
  chars.forEach((char, index) => {
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        for (let i = start; i <= index; i += 1) if (chars[i] !== "\n") chars[i] = " ";
      }
    }
  });
  return chars.join("");
};

/**
 * Removes the parts of a comment that are not prose, so only the words a person wrote are checked.
 * Removed: code in backticks, URLs, the leading star on each line of a block comment and, in JSDoc, the type
 * braces and `@example` sections. The result has the same length and lines as the input.
 * @param {string} text The comment without its `//` or `/*` and `*\/` markers.
 * @param {{ jsdoc: boolean }} options Pass `jsdoc: true` for a `/** *\/` comment.
 * @returns {string} The prose of the comment, with everything else blanked out.
 */
export const proseOf = (text, { jsdoc }) => {
  let prose = blank(text, /```[\s\S]*?```/g);
  prose = blank(prose, /(`+)[\s\S]*?\1/g);
  prose = blank(prose, /\bhttps?:\/\/\S+/g);
  if (jsdoc) {
    prose = blank(prose, /@example[\s\S]*?(?=\n\s*\*?\s*@\w|$)/g);
    prose = blankBraces(prose);
  }
  return blank(prose, /^[ \t]*\*+/gm);
};

/**
 * @typedef {Object} CommentProblem
 * @property {keyof typeof PROBLEMS} id Which rule the comment breaks.
 * @property {number} index Where the problem starts, counted in characters from the start of the comment text.
 * @property {string} found The characters that broke the rule.
 */

/**
 * Checks one comment against the comment style rule.
 * @param {string} text The comment without its `//` or `/*` and `*\/` markers.
 * @param {{ block: boolean }} options Pass `block: true` for a `/* *\/` comment. A block comment whose text starts
 *   with a star is JSDoc.
 * @returns {ReadonlyArray<CommentProblem>} Every problem in the comment, in order. Empty when the comment is fine.
 */
export const checkComment = (text, { block }) => {
  if (DIRECTIVE.test(text)) return Object.freeze([]);
  const prose = proseOf(text, { jsdoc: block && text.startsWith("*") });
  const problems = [...prose.matchAll(PATTERN)].map((match) => {
    const [id] = Object.entries(match.groups).find(([, value]) => value !== undefined);
    const found = match.groups[id].trim();
    return Object.freeze({ id, index: match.index + match[0].indexOf(found), found });
  });
  return Object.freeze(problems);
};
