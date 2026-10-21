import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AT_RULES,
  checkCss,
  checkCssFiles,
  customPropertiesIn,
  readTokenFiles,
  readTokens,
  RULES,
  TOKENS_FILE,
} from "./design/cssTokens.mjs";
import { TOKEN_EXCEPTIONS, TOKEN_EXCEPTIONS_CEILING } from "./design/tokenExceptions.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const CONTRACT = readFileSync(path.join(ROOT, "docs/design/CONTRACT.md"), "utf8");
const TOKENS = readTokens(
  ":root { --space-4: 1rem; --space-2: 0.5rem; --text-md: 1rem; --color-text: #161827; --color-gold: #ffd34d; " +
    "--color-tier-gold: #ffd34d; --layer-effect: 40; --layer-dialog: 30; --breakpoint-sm: 30rem; }",
);
const PAGE = "apps/web/src/pages/HomePage/HomePage.module.css";

const problemsIn = (css, file = PAGE) => checkCss({ css, file, tokens: TOKENS });
const messages = (css, file) => problemsIn(css, file).map(({ message }) => message);

describe("the CSS token check", () => {
  it("refuses raw colours, sizes and z-index outside tokens.css", () => {
    const css = [
      ".a {",
      "  color: #161827;",
      "  background: rgb(10 10 25 / 55%);",
      "  border: 2px solid red;",
      "  z-index: 40;",
      "  font-size: 14px;",
      "  padding: 1rem var(--space-2);",
      "  margin: calc(1px * 12);",
      "  --gap: 4px;",
      "  --tone: hsl(0 0% 100%);",
      "}",
    ].join("\n");
    expect(problemsIn(css)).toEqual([
      {
        line: 2,
        column: 3,
        rule: "classicade/no-raw-colour",
        message: expect.stringContaining(
          'Raw colour "#161827" in color. Use a colour role from tokens.css, here var(--color-text)',
        ),
      },
      { line: 3, column: 3, rule: "classicade/no-raw-colour", message: expect.stringContaining('"rgb("') },
      {
        line: 4,
        column: 3,
        rule: "classicade/no-raw-colour",
        message: expect.stringContaining('"red" in border'),
      },
      {
        line: 5,
        column: 3,
        rule: "classicade/layer-tokens",
        message: expect.stringContaining("z-index: 40 is not a layer. Use var(--layer-effect)"),
      },
      {
        line: 6,
        column: 3,
        rule: "classicade/size-tokens",
        message: expect.stringContaining('Raw size "14px" in font-size. Use a --type-* or --text-* token'),
      },
      {
        line: 7,
        column: 3,
        rule: "classicade/size-tokens",
        message: expect.stringContaining('Raw size "1rem" in padding. Use var(--space-4)'),
      },
      {
        line: 8,
        column: 3,
        rule: "classicade/size-tokens",
        message: expect.stringContaining('"1px" in margin'),
      },
      {
        line: 9,
        column: 3,
        rule: "classicade/size-tokens",
        message: expect.stringContaining('"4px" in the custom property --gap'),
      },
      { line: 10, column: 3, rule: "classicade/no-raw-colour", message: expect.stringContaining('"hsl("') },
    ]);
    for (const { message } of problemsIn(css)) {
      expect(message).toContain("docs/design/CONTRACT.md");
    }
  });

  it("points at the layer tokens when no layer has the raw value", () => {
    expect(messages(".a { z-index: 99; }")).toEqual([expect.stringContaining("Use a var(--layer-*) token")]);
  });

  it("names the font size tokens when a size matches one", () => {
    expect(messages(".a { font-size: 1rem; }")).toEqual([expect.stringContaining("Use var(--text-md)")]);
  });

  it("lets through tokens, zero, relative units, keywords and words that only look like colours", () => {
    const css = [
      ".a {",
      "  color: var(--color-text);",
      "  background: transparent;",
      "  border: 2px solid currentColor;",
      "  z-index: var(--layer-dialog);",
      "  padding: 0 0px 0rem 5%;",
      "  margin: auto 1em 2ch 3vw;",
      "  gap: calc(var(--space-2) * 2);",
      "  line-height: 1.5;",
      "  font-size: inherit;",
      '  content: "#1 red";',
      "  background-image: url(#gradient);",
      "  animation: red-pulse 1s;",
      "  fill: var(--color-gold, var(--color-text));",
      "  --tier: var(--color-tier-gold);",
      "  width: 12px;",
      "}",
      ".b { z-index: auto; }",
      ".c { z-index: initial; }",
      ".d { position: sticky; }",
    ].join("\n");
    expect(problemsIn(css)).toEqual([]);
  });

  it("never checks the token files themselves", () => {
    expect(problemsIn(".a { color: #fff; z-index: 3; }", TOKENS_FILE)).toEqual([]);
    expect(problemsIn(":root { --color-bg: #fff; }", "apps/web/src/styles/tokens/palette.css")).toEqual([]);
  });

  it("refuses position: fixed outside the contract's pop-up components", () => {
    expect(messages(".a { position: fixed; }")).toEqual([
      expect.stringContaining("position: fixed draws over the page"),
    ]);
    expect(problemsIn(".a { position: fixed; }", "apps/web/src/components/Modal/Modal.module.css")).toEqual(
      [],
    );
  });

  it("gives every rule a classicade name", () => {
    expect(RULES.map(({ name }) => name)).toEqual([
      "classicade/no-raw-colour",
      "classicade/layer-tokens",
      "classicade/size-tokens",
      "classicade/known-custom-properties",
      "classicade/popup-position",
    ]);
    expect(AT_RULES.map(({ name }) => name)).toEqual(["classicade/breakpoint-tokens"]);
  });

  it("refuses a var() that no stylesheet declares, such as --text-base or --space-5 (CC-323 AC-14)", () => {
    expect(
      problemsIn(".a {\n  font-size: var(--text-base);\n  padding: var(--space-5, var(--space-4));\n}"),
    ).toEqual([
      {
        line: 2,
        column: 3,
        rule: "classicade/known-custom-properties",
        message: expect.stringContaining(
          "var(--text-base) in font-size names a custom property that no stylesheet",
        ),
      },
      {
        line: 3,
        column: 3,
        rule: "classicade/known-custom-properties",
        message: expect.stringContaining("var(--space-5) in padding"),
      },
    ]);
  });

  it("lets through a custom property the same file declares, or one another stylesheet declares", () => {
    expect(problemsIn(".a { --tone: var(--color-text); color: var(--tone); }")).toEqual([]);
    const known = new Set(["--from-elsewhere"]);
    expect(
      checkCss({ css: ".a { color: var(--from-elsewhere); }", file: PAGE, tokens: TOKENS, known }),
    ).toEqual([]);
    expect(customPropertiesIn(".a { --one: 1; } .b { --two: 2; color: red; }")).toEqual(
      new Set(["--one", "--two"]),
    );
  });

  it("refuses a media query width that is not a breakpoint token (CC-323 AC-14)", () => {
    expect(problemsIn("@media (max-width: 30rem) { .a { color: var(--color-text); } }")).toEqual([]);
    expect(
      problemsIn("@media (prefers-reduced-motion: reduce) { .a { color: var(--color-text); } }"),
    ).toEqual([]);
    expect(
      problemsIn("@media (min-width: 31rem) and (width <= 50rem) { .a { color: var(--color-text); } }"),
    ).toEqual([
      {
        line: 1,
        column: 1,
        rule: "classicade/breakpoint-tokens",
        message: expect.stringContaining("@media width 31rem is not a breakpoint"),
      },
      {
        line: 1,
        column: 1,
        rule: "classicade/breakpoint-tokens",
        message: expect.stringContaining("@media width 50rem is not a breakpoint"),
      },
    ]);
  });

  it("passes on main: no raw z-index and no raw font size outside the exceptions (AC-5)", () => {
    const lines = [];
    expect(checkCssFiles({ root: ROOT, log: (line) => lines.push(line) })).toBe(0);
    expect(lines).toEqual([]);
  });
});

describe("the exceptions list", () => {
  const section = CONTRACT.split("<!-- token-exceptions:start -->")[1].split(
    "<!-- token-exceptions:end -->",
  )[0];
  const rows = [...section.matchAll(/^\| `([^`]+)` +\| `([^`]+)` +\|/gm)].map(([, file, property]) => ({
    file,
    property,
  }));

  it("the exceptions list only shrinks", () => {
    expect(TOKEN_EXCEPTIONS.length).toBeLessThanOrEqual(TOKEN_EXCEPTIONS_CEILING);
    expect(rows).toEqual(TOKEN_EXCEPTIONS.map(({ file, property }) => ({ file, property })));
    for (const { reason } of TOKEN_EXCEPTIONS) {
      expect(reason).toMatch(/\.$/);
    }
  });

  it("holds only entries still needed: each one lets through a raw value that is really there", () => {
    const tokens = readTokens(readTokenFiles(ROOT));
    for (const entry of TOKEN_EXCEPTIONS) {
      const css = readFileSync(path.join(ROOT, entry.file), "utf8");
      const others = TOKEN_EXCEPTIONS.filter((other) => other !== entry);
      const found = checkCss({ css, file: entry.file, tokens, exceptions: others });
      expect(found.length, `${entry.file} ${entry.property} is no longer needed`).toBeGreaterThan(0);
    }
  });
});

describe("checkCssFiles", () => {
  let root;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reports each problem as file, line and column, message and rule, and counts them", () => {
    root = mkdtempSync(path.join(tmpdir(), "css-tokens-"));
    mkdirSync(path.join(root, "apps/web/src/styles"), { recursive: true });
    mkdirSync(path.join(root, "apps/web/src/components/X"), { recursive: true });
    writeFileSync(path.join(root, TOKENS_FILE), ":root { --layer-toast: 20; }\n");
    writeFileSync(path.join(root, "apps/web/src/components/X/X.module.css"), ".x {\n  z-index: 20;\n}\n");
    const lines = [];
    expect(checkCssFiles({ root, log: (line) => lines.push(line) })).toBe(1);
    expect(lines).toEqual([
      "apps/web/src/components/X/X.module.css:2:3  z-index: 20 is not a layer. Use var(--layer-toast) from tokens.css " +
        "(docs/design/CONTRACT.md).  classicade/layer-tokens",
    ]);
  });
});
