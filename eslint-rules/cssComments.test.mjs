import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkCssComments, checkCssFiles, stripCssComments } from "./cssComments.mjs";

describe("checkCssComments", () => {
  it("accepts clean comments and ignores the CSS around them", () => {
    expect(
      checkCssComments("a { color: red; } /* Red, because the brand says so. */\nb { margin: 0; }"),
    ).toEqual([]);
  });

  it("reports the line and column of each problem", () => {
    const css = "a { color: red; }\n/* One; two.\n * Three — four. */";
    expect(checkCssComments(css)).toEqual([
      { line: 2, column: 7, message: expect.stringContaining("semicolons") },
      { line: 3, column: 10, message: expect.stringContaining("dashes") },
    ]);
  });

  it("names the jargon it found", () => {
    const [problem] = checkCssComments("/* Use this, e.g. here. */");
    expect(problem.message).toMatch(/^"e\.g\." is jargon/);
  });

  it("does not take a comment marker inside a quoted string for a comment", () => {
    expect(checkCssComments(`a::before { content: "/* x; y */"; } b::after { content: '/*;'; }`)).toEqual([]);
  });

  it("allows CSS variable names, which start with two hyphens", () => {
    expect(checkCssComments("/* Darker than --color-bg in both themes. */")).toEqual([]);
  });

  it("still checks a comment that is never closed", () => {
    expect(checkCssComments("a {}\n/* Unclosed; comment")).toHaveLength(1);
  });

  it("returns a frozen list", () => {
    expect(Object.isFrozen(checkCssComments(""))).toBe(true);
  });
});

describe("stripCssComments", () => {
  it("removes comments but keeps strings that look like comments", () => {
    expect(stripCssComments(`a { content: "/* kept */"; } /* gone */ b {}`)).toBe(
      `a { content: "/* kept */"; }  b {}`,
    );
  });
});

describe("checkCssFiles", () => {
  let root;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const makeRepo = (files) => {
    root = mkdtempSync(join(tmpdir(), "css-comments-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  };

  it("checks CSS files in the given folders only and logs each problem", () => {
    makeRepo({
      "clean/b.css": "/* Bad; one. */",
      "clean/a/a.css": "/* Bad; two. */ /* Also bad — three. */",
      "clean/fine.css": "/* Fine. */",
      "clean/node_modules/x.css": "/* Bad; but a dependency. */",
      "clean/code.js": "// Not CSS; skipped.",
      "later/c.css": "/* Bad; not swept yet. */",
    });
    const lines = [];
    expect(checkCssFiles({ root, paths: ["clean"], log: (line) => lines.push(line) })).toBe(3);
    expect(lines).toEqual([
      expect.stringMatching(/^clean\/a\/a\.css:1:7 .*semicolons.*classicade\/comment-style$/),
      expect.stringMatching(/^clean\/a\/a\.css:1:29 .*dashes/),
      expect.stringMatching(/^clean\/b\.css:1:7 /),
    ]);
  });

  it("checks the folders where the rule is on unless told otherwise", () => {
    makeRepo({ "packages/shared/x.css": "/* Bad; here. */", "apps/web/y.css": "/* Bad; later. */" });
    expect(checkCssFiles({ root, log: () => {} })).toBe(1);
  });
});
