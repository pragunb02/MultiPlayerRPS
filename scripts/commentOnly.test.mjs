import { describe, expect, it } from "vitest";
import { codeTokens, filesWithCodeChanges, isCheckable } from "./commentOnly.mjs";

describe("codeTokens", () => {
  it("leaves out comments and layout from JavaScript", () => {
    const before = codeTokens({ path: "a.js", source: "// Old; note.\nconst a = 1; /* x */" });
    const after = codeTokens({ path: "a.js", source: "// New note.\n\nconst a =\n  1;" });
    expect(after).toEqual(before);
    expect(before).toContain("Numeric 1");
  });

  it("reads JSX", () => {
    expect(codeTokens({ path: "a.jsx", source: "<p>{/* note */}</p>;" })).toContain("JSXIdentifier p");
  });

  it("leaves out comments and squeezes whitespace in CSS", () => {
    expect(codeTokens({ path: "a.css", source: "/* x */\na {\n  color: red;\n}\n" })).toEqual([
      "a { color: red; }",
    ]);
  });
});

describe("isCheckable", () => {
  it("accepts JavaScript and CSS files only", () => {
    expect(["a.js", "a.jsx", "a.mjs", "a.cjs", "a.css"].every(isCheckable)).toBe(true);
    expect(["a.md", "a.json", "Dockerfile"].some(isCheckable)).toBe(false);
  });
});

describe("filesWithCodeChanges", () => {
  it("returns nothing when only comments changed", () => {
    const files = [
      { path: "a.js", before: "// One; two.\nf();", after: "// One. Two.\nf();" },
      { path: "b.css", before: "/* Old. */ a {}", after: "/* New. */\na {}" },
    ];
    expect(filesWithCodeChanges(files)).toEqual([]);
  });

  it("names every file whose code changed, including a changed string or an added token", () => {
    const files = [
      { path: "same.js", before: "f();", after: "f(); // Note." },
      { path: "value.js", before: 'f("a");', after: 'f("b");' },
      { path: "longer.js", before: "f()", after: "f();" },
      { path: "style.css", before: "a { color: red; }", after: "a { color: blue; }" },
    ];
    expect(filesWithCodeChanges(files)).toEqual(["value.js", "longer.js", "style.css"]);
  });
});
