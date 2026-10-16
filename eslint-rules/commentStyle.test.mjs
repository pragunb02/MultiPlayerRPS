import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { classicadePlugin, commentStyleRule } from "./commentStyle.mjs";

// RuleTester looks for test functions on itself. Hand it the ones from Vitest.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("classicade plugin", () => {
  it("registers the rule as comment-style", ({ expect }) => {
    expect(classicadePlugin.rules["comment-style"]).toBe(commentStyleRule);
    expect(classicadePlugin.meta.name).toBe("classicade");
  });
});

tester.run("classicade/comment-style", commentStyleRule, {
  valid: [
    "// A plain sentence that ends with a full stop.",
    "/* A block comment, with a comma and a colon: like this. */",
    // Hyphens inside words, ticket IDs and ranges written with words are fine.
    "// A best-of-3 match is read-only after the last round (see CC-089).",
    "// Scores go from 1 to 3.",
    "// Negative numbers such as -1 are fine, and so is x-1.",
    // Code inside backticks is exempt, even across a line in a block comment.
    "// Call `a; b` or `x => y` or `a -- b` or ``it`s`` here.",
    "/* The call\n   `first();\n   second();` runs both. */",
    "/**\n * Example:\n * ```\n * run(); // twice — fine\n * ```\n */",
    // URLs are exempt.
    "// Spec: https://example.com/a;b--c?x=1#e.g.",
    // JSDoc types and @example sections are code.
    "/**\n * Adds two numbers.\n * @param {{ a: number; b: number }} pair The numbers.\n * @returns {(x: number) => number} A function.\n */",
    "/**\n * Runs it.\n * @example\n * run(); run(); // => same\n * @returns {void} Nothing.\n */",
    "/**\n * A multi-line type.\n * @typedef {{\n *   a: string;\n *   b: number;\n * }} Pair\n */",
    // CSS variables and command flags start with two hyphens, but they are names, not punctuation.
    "// The colour comes from --color-bg, so run it with --watch.",
    // Lint and Prettier directives speak to a tool, so their wording is free.
    "// eslint-disable-next-line no-console -- logging is the point here; really",
    "/* eslint-disable no-console */",
    "/* global window; */",
    "// prettier-ignore",
    "/* v8 ignore next -- covered elsewhere */",
    "#!/usr/bin/env node\n// Runs the tool.",
    // Words that only look like the denylisted ones.
    "// An etcher draws an image. The i.ex file is a name.",
    "// Comment in JSX.\nconst a = <div>{/* A plain comment. */}</div>;",
  ],
  invalid: [
    {
      code: "// First part; second part.",
      errors: [{ messageId: "semicolon", line: 1, column: 14, endColumn: 15 }],
    },
    {
      code: "// One — two – three.",
      errors: [
        { messageId: "dash", column: 8 },
        { messageId: "dash", column: 14 },
      ],
    },
    {
      code: "// One - two.",
      errors: [{ messageId: "spacedHyphen", column: 8 }],
    },
    {
      code: "// Trailing hyphen -",
      errors: [{ messageId: "spacedHyphen", column: 20 }],
    },
    {
      code: "/**\n * Adds.\n * @param {number} a - the first number.\n */",
      errors: [{ messageId: "spacedHyphen", line: 3, column: 22 }],
    },
    {
      code: "// One -- two. Also one--- and the end --",
      errors: [
        { messageId: "doubleHyphen", column: 8 },
        { messageId: "doubleHyphen", column: 24 },
        { messageId: "doubleHyphen", column: 40 },
      ],
    },
    {
      code: "// - first item\n// - second item",
      errors: [
        { messageId: "hyphenBullet", line: 1, column: 4 },
        { messageId: "hyphenBullet", line: 2, column: 4 },
      ],
    },
    {
      code: "/*\n * Steps:\n *   - first\n */",
      errors: [{ messageId: "hyphenBullet", line: 3, column: 6 }],
    },
    {
      code: "// a -> b => c --> d <- e → f ← g ⇒ h ↔ i",
      errors: Array.from({ length: 8 }, () => ({ messageId: "arrow" })),
    },
    {
      code: "// It is idempotent, an upsert, exactly-once, uses the observer pattern, e.g. this, i.e. that, etc.",
      errors: [
        { messageId: "jargon", data: { found: "idempotent" } },
        { messageId: "jargon", data: { found: "upsert" } },
        { messageId: "jargon", data: { found: "exactly-once" } },
        { messageId: "jargon", data: { found: "observer pattern" } },
        { messageId: "jargon", data: { found: "e.g." } },
        { messageId: "jargon", data: { found: "i.e." } },
        { messageId: "jargon", data: { found: "etc." } },
      ],
    },
    {
      code: "// Idempotency and Upserted rows, eg e.g without dots.",
      errors: [
        { messageId: "jargon", data: { found: "Idempotency" } },
        { messageId: "jargon", data: { found: "Upserted" } },
        { messageId: "jargon", data: { found: "e.g" } },
      ],
    },
    {
      // An unclosed backtick does not hide the rest of the comment.
      code: "// Open `quote; never closed.",
      errors: [{ messageId: "semicolon" }],
    },
    {
      // Braces are only types in JSDoc. In a plain block comment their content is prose.
      code: "/* Returns {a; b}. */",
      errors: [{ messageId: "semicolon" }],
    },
    {
      // A closing brace without an opening one does not hide anything.
      code: "/** Ends } here; badly. */",
      errors: [{ messageId: "semicolon" }],
    },
    {
      code: "const x = 1; // Trailing comment; with a semicolon.",
      errors: [{ messageId: "semicolon", column: 33 }],
    },
    {
      code: "<div>{/* In JSX; too. */}</div>;",
      errors: [{ messageId: "semicolon", column: 16 }],
    },
  ],
});
