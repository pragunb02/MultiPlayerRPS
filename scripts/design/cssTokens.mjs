import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { CONTRACT_FILE, isPopupComponent } from "../../eslint-rules/popupContract.mjs";
import { TOKEN_EXCEPTIONS } from "./tokenExceptions.mjs";

/**
 * The CSS token check of the design contract (docs/design/CONTRACT.md, CC-314). Outside the token files a CSS file may
 * not write a raw colour, a raw `z-index`, a raw size in a type, spacing or radius property, a custom property that
 * holds a raw colour or size, or `position: fixed` outside the contract's pop-up components.
 *
 * Each rule has the shape of a stylelint plugin rule: it is given one declaration of a PostCSS parse and reports a
 * message about it. The owner chose stylelint (CC-314, D4), but stylelint 17 brings a high `npm audit` finding with
 * no fix yet, so this file runs the rules itself until stylelint 18. Moving then means wrapping each rule with
 * `stylelint.createPlugin`. The rules and their tests stay the same.
 */

/** The tokens' entry file. It imports one file per role from TOKENS_FOLDER. */
export const TOKENS_FILE = "apps/web/src/styles/tokens.css";

/** The one folder allowed to hold raw values: a file per role, such as the palette or the type scale. */
export const TOKENS_FOLDER = "apps/web/src/styles/tokens/";

/**
 * Whether a file is one of the token files, which hold the raw values and are never checked.
 *
 * @param {string} file  a path from the repository root
 * @returns {boolean}
 */
export const isTokenFile = (file) => file === TOKENS_FILE || file.startsWith(TOKENS_FOLDER);

/**
 * The text of every token file, the entry file first, as one stylesheet.
 *
 * @param {string} root  the repository root
 * @returns {string}
 */
export function readTokenFiles(root) {
  const roles = globSync(`${TOKENS_FOLDER}*.css`, { cwd: root }).map((name) => name.replaceAll("\\", "/"));
  return [TOKENS_FILE, ...roles.sort()].map((file) => readFileSync(join(root, file), "utf8")).join("\n");
}

/** Every CSS file the check reads. */
export const CSS_FILES = "apps/web/src/**/*.css";

// CSS Color 4 named colours. `transparent` and `currentColor` are not here: they name no colour of their own.
const NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred " +
    "darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink " +
    "deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold " +
    "goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush " +
    "lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey " +
    "lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow " +
    "lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin " +
    "navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise " +
    "palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue " +
    "saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow " +
    "springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

// Properties whose value can hold a colour. A named colour is only looked for here, so a word such as an
// animation's name is never taken for one.
const COLOUR_PROPERTY =
  /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?|filter|stop-color|flood-color|scrollbar-color|--.+)$/;

// Properties that take a type, spacing or radius token.
const SIZE_PROPERTIES = Object.freeze([
  Object.freeze({ pattern: /^font-size$/, family: "--text-", hint: "a --type-* or --text-* token" }),
  Object.freeze({ pattern: /^line-height$/, family: "--leading-", hint: "a --leading-* token" }),
  Object.freeze({ pattern: /^border(?:-[a-z]+)*-radius$/, family: "--radius-", hint: "a --radius-* token" }),
  Object.freeze({ pattern: /^(?:row-|column-)?gap$/, family: "--space-", hint: "a --space-* token" }),
  Object.freeze({
    pattern: /^(?:padding|margin)(?:-[a-z]+)*$/,
    family: "--space-",
    hint: "a --space-* token",
  }),
]);

const GLOBAL_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);
const LAYER = /^var\(--layer-[a-z0-9-]+\)$/;
const HEX = /#[0-9a-f]{3,8}\b/i;
const COLOUR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const WORD = /(?<![\w-])[a-z][a-z-]*(?![\w-])/gi;
const RAW_SIZE = /(?<![\w.-])-?(?:\d*\.\d+|\d+)(?:px|rem)\b/gi;

/**
 * A value with its quoted strings, its `url()` addresses and its custom property names blanked, so that only the
 * CSS itself is read. A token called `--color-gold` is not the named colour gold.
 */
const cssOf = (value) =>
  value
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
    .replace(/url\([^)]*\)/gi, "url()")
    .replace(/--[\w-]+/g, "--x");

/** The raw sizes in a value, leaving out zero, which needs no token. */
const rawSizesIn = (value) =>
  [...cssOf(value).matchAll(RAW_SIZE)]
    .map(([found]) => found)
    .filter((found) => Number.parseFloat(found) !== 0);

/** The first raw colour in a value, or an empty string when there is none. */
const rawColourIn = (property, value) => {
  const css = cssOf(value);
  const hex = HEX.exec(css);
  if (hex) return hex[0];
  const fn = COLOUR_FUNCTION.exec(css);
  if (fn) return fn[0];
  if (!COLOUR_PROPERTY.test(property)) return "";
  return (
    [...css.matchAll(WORD)].map(([word]) => word).find((word) => NAMED_COLOURS.has(word.toLowerCase())) ?? ""
  );
};

/**
 * Reads the light theme's tokens from the token files, so a message can name the token that already holds a raw value.
 *
 * @param {string} css  the text of the token files, as readTokenFiles gives it
 * @returns {ReadonlyMap<string, ReadonlyArray<string>>} each value and the tokens that hold it
 */
export function readTokens(css) {
  const byValue = new Map();
  const root = postcss.parse(css);
  root.each((node) => {
    if (node.type !== "rule" || node.selector !== ":root") return;
    node.walkDecls(/^--/, (decl) => byValue.set(decl.value, [...(byValue.get(decl.value) ?? []), decl.prop]));
  });
  return byValue;
}

/** The tokens of one family that hold a value, as `var(--name)`, or an empty string. */
const tokenFor = (tokens, value, family) => {
  const names = (tokens.get(value) ?? []).filter(
    (name) => name.startsWith(family) || (family === "--text-" && name.startsWith("--type-")),
  );
  return names.map((name) => `var(${name})`).join(" or ");
};

const SEE = `(${CONTRACT_FILE})`;

const VAR_NAME = /var\(\s*(--[\w-]+)/g;

/**
 * The custom properties a stylesheet declares, in any rule, so a `var()` can be told apart from a typo.
 *
 * @param {string} css  the text of a stylesheet
 * @returns {ReadonlySet<string>}
 */
export function customPropertiesIn(css) {
  const names = new Set();
  postcss.parse(css).walkDecls(/^--/, (decl) => names.add(decl.prop));
  return names;
}

/** Every token name the token map holds. */
const tokenNames = (tokens) => new Set([...tokens.values()].flat());

// A width in a media query: `(max-width: 30rem)`, `(min-width: 64rem)` or the range form `(width <= 40rem)`.
const MEDIA_WIDTH = /(?<![\w-])(?:min-|max-)?width\s*(?::|[<>]=?)\s*(-?[\d.]+[a-z]+)/gi;

/**
 * The rules, in the order they are reported. Each gets `{ decl, file, tokens, report }`: one declaration, the file's
 * path from the repository root, the token values, and a function that takes a message.
 */
export const RULES = Object.freeze([
  Object.freeze({
    name: "classicade/no-raw-colour",
    check({ decl, tokens, report }) {
      const found = rawColourIn(decl.prop, decl.value);
      if (found === "") return;
      const token = tokenFor(tokens, found, "--color-");
      report(
        `Raw colour "${found}" in ${decl.prop}. Use a colour role from tokens.css${token ? `, here ${token}` : ""} ${SEE}.`,
      );
    },
  }),
  Object.freeze({
    name: "classicade/layer-tokens",
    check({ decl, tokens, report }) {
      if (decl.prop !== "z-index") return;
      const value = decl.value.trim();
      if (LAYER.test(value) || value === "auto" || GLOBAL_KEYWORDS.has(value)) return;
      const token = tokenFor(tokens, value, "--layer-");
      report(
        `z-index: ${value} is not a layer. Use ${token || "a var(--layer-*) token"} from tokens.css ${SEE}.`,
      );
    },
  }),
  Object.freeze({
    name: "classicade/size-tokens",
    check({ decl, tokens, report }) {
      const size = SIZE_PROPERTIES.find(({ pattern }) => pattern.test(decl.prop));
      const custom = decl.prop.startsWith("--");
      if (size === undefined && !custom) return;
      for (const found of rawSizesIn(decl.value)) {
        if (custom) {
          report(
            `Raw size "${found}" in the custom property ${decl.prop}. Sizes are defined in tokens.css only ${SEE}.`,
          );
          continue;
        }
        const token = tokenFor(tokens, found, size.family);
        report(`Raw size "${found}" in ${decl.prop}. Use ${token || size.hint} from tokens.css ${SEE}.`);
      }
    },
  }),
  Object.freeze({
    name: "classicade/known-custom-properties",
    check({ decl, known, report }) {
      for (const [, name] of decl.value.matchAll(VAR_NAME)) {
        if (known.has(name)) continue;
        report(
          `var(${name}) in ${decl.prop} names a custom property that no stylesheet declares, so the declaration ` +
            `does nothing. Use a token from tokens.css or declare it ${SEE}.`,
        );
      }
    },
  }),
  Object.freeze({
    name: "classicade/popup-position",
    check({ decl, file, report }) {
      if (decl.prop !== "position" || decl.value.trim() !== "fixed" || isPopupComponent(file)) return;
      report(
        `position: fixed draws over the page, which makes a new pop-up. Use the contract's Modal, a toast or a ` +
          `banner, or change ${CONTRACT_FILE} first and add this file to POPUP_COMPONENTS.`,
      );
    },
  }),
]);

/**
 * The rules over at-rules, in the order they are reported. Each gets `{ atRule, tokens, report }`.
 */
export const AT_RULES = Object.freeze([
  Object.freeze({
    name: "classicade/breakpoint-tokens",
    check({ atRule, tokens, report }) {
      if (atRule.name !== "media") return;
      for (const [, width] of atRule.params.matchAll(MEDIA_WIDTH)) {
        if (tokenFor(tokens, width, "--breakpoint-") !== "") continue;
        report(
          `@media width ${width} is not a breakpoint. Use the width of a --breakpoint-* token from tokens.css ` +
            `(a media query cannot read var()) ${SEE}.`,
        );
      }
    },
  }),
]);

const excepted = (exceptions, file, property) =>
  exceptions.some((entry) => entry.file === file && entry.property === property);

/**
 * @typedef {Object} CssTokenProblem
 * @property {number} line The line of the declaration, counted from 1.
 * @property {number} column The column of the declaration, counted from 1.
 * @property {string} rule The rule's name.
 * @property {string} message What is wrong and what to write instead.
 */

/**
 * Checks one CSS file against every rule. The token files themselves are never checked.
 *
 * @param {{
 *   css: string,
 *   file: string,
 *   tokens: ReadonlyMap<string, ReadonlyArray<string>>,
 *   exceptions?: ReadonlyArray<{ file: string, property: string }>,
 *   known?: ReadonlySet<string>,
 * }} options The file's text, its path from the repository root, the token values from `readTokens`, the
 *   exceptions to let through (TOKEN_EXCEPTIONS unless given), and every custom property any stylesheet declares
 *   (unless given, the tokens and the ones this file declares).
 * @returns {ReadonlyArray<CssTokenProblem>} Every problem, in order. Empty when the file follows the contract.
 */
export function checkCss({ css, file, tokens, exceptions = TOKEN_EXCEPTIONS, known }) {
  if (isTokenFile(file)) return Object.freeze([]);
  const declared = known ?? new Set([...tokenNames(tokens), ...customPropertiesIn(css)]);
  const problems = [];
  const reporter = (node, name) => {
    const { line, column } = node.source.start;
    return (message) => problems.push({ line, column, rule: name, message });
  };
  const root = postcss.parse(css, { from: file });
  root.walk((node) => {
    if (node.type === "atrule") {
      for (const rule of AT_RULES) rule.check({ atRule: node, tokens, report: reporter(node, rule.name) });
      return;
    }
    if (node.type !== "decl" || excepted(exceptions, file, node.prop)) return;
    for (const rule of RULES) {
      rule.check({ decl: node, file, tokens, known: declared, report: reporter(node, rule.name) });
    }
  });
  return Object.freeze(problems);
}

/**
 * Checks every CSS file of the web app, as `npm run lint` does.
 *
 * @param {{ root: string, log: (line: string) => void }} options The repository root and where to write each problem.
 * @returns {number} How many problems were found, so the caller can fail the lint run.
 */
export function checkCssFiles({ root, log }) {
  const tokenCss = readTokenFiles(root);
  const tokens = readTokens(tokenCss);
  const files = globSync(CSS_FILES, { cwd: root, exclude: (name) => name === "node_modules" });
  const sorted = [...files].map((name) => name.replaceAll("\\", "/")).sort();
  const texts = new Map(sorted.map((file) => [file, readFileSync(join(root, file), "utf8")]));
  // A custom property declared in one stylesheet may be read in another, such as a theme set on a parent.
  const known = new Set([
    ...customPropertiesIn(tokenCss),
    ...[...texts.values()].flatMap((css) => [...customPropertiesIn(css)]),
  ]);
  let count = 0;
  for (const file of sorted) {
    for (const { line, column, rule, message } of checkCss({ css: texts.get(file), file, tokens, known })) {
      log(`${file}:${line}:${column}  ${message}  ${rule}`);
      count += 1;
    }
  }
  return count;
}
