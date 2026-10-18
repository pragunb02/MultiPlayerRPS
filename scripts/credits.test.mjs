import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_SVG_BYTES, creditProblems, fileSize, listFiles, needsCredit, parseCredits } from "./credits.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** One credit row with every column filled in, changed by the overrides. */
const credit = (overrides = {}) => ({
  file: "apps/web/public/a.png",
  what: "A picture",
  author: "ClassiCade",
  licence: "LicenseRef-ClassiCade",
  source: "Drawn for ClassiCade",
  added: "2026-10-18",
  ...overrides,
});

const tiny = () => 100;

// The real check: this is the test that fails when someone adds a picture without a credit, or deletes one and
// leaves its row behind.
describe("docs/CREDITS.md", () => {
  it("credits every asset in the web app, names only files that exist, and keeps SVGs small", () => {
    const credits = parseCredits(readFileSync(path.join(root, "docs/CREDITS.md"), "utf8"));
    const files = listFiles({ root, folder: "apps/web" });

    const problems = creditProblems({ credits, files, sizeOf: (file) => fileSize({ root, file }) });

    expect(problems).toEqual([]);
    expect(credits.length).toBeGreaterThan(0);
  });
});

describe("needsCredit", () => {
  it("counts images, sounds and fonts, whatever the case of the extension", () => {
    const assets = ["a.svg", "b.PNG", "c.jpg", "d.webp", "e.mp3", "f.ogg", "g.woff2", "h.ttf"];
    expect(assets.every(needsCredit)).toBe(true);
  });

  it("counts art components but not their tests or other code", () => {
    expect(needsCredit("apps/web/src/art/bit/Bit.jsx")).toBe(true);
    expect(needsCredit("apps/web/src/art/bit/Bit.test.jsx")).toBe(false);
    expect(needsCredit("apps/web/src/art/bit/bitPoses.js")).toBe(false);
    expect(needsCredit("apps/web/src/components/Button/Button.jsx")).toBe(false);
    expect(needsCredit("apps/web/public/pieces/LICENSE.md")).toBe(false);
  });
});

describe("parseCredits", () => {
  it("reads table rows that start with a file in backticks and skips everything else", () => {
    const markdown = [
      "# Credits",
      "",
      "| File | What | Author | Licence | Source | Added |",
      "| ---- | ---- | ------ | ------- | ------ | ----- |",
      "| `apps/web/public/a.png` | A picture | Ana | CC0-1.0 | https://example.org/a | 2026-10-18 |",
      "Some prose with `apps/web/public/b.png` in it.",
    ].join("\n");

    expect(parseCredits(markdown)).toEqual([
      credit({ author: "Ana", licence: "CC0-1.0", source: "https://example.org/a" }),
    ]);
  });

  it("leaves missing cells empty", () => {
    expect(parseCredits("| `a.svg` | A star |")).toEqual([
      { file: "a.svg", what: "A star", author: "", licence: "", source: "", added: "" },
    ]);
  });
});

describe("creditProblems", () => {
  it("finds nothing wrong when every asset has a complete row", () => {
    const problems = creditProblems({
      credits: [credit()],
      files: ["apps/web/public/a.png", "apps/web/src/main.jsx"],
      sizeOf: tiny,
    });

    expect(problems).toEqual([]);
  });

  it("reports an asset with no row", () => {
    const problems = creditProblems({ credits: [], files: ["apps/web/public/new.webp"], sizeOf: tiny });

    expect(problems).toEqual(["apps/web/public/new.webp has no row in docs/CREDITS.md"]);
  });

  it("reports a row for a file that no longer exists", () => {
    const problems = creditProblems({ credits: [credit()], files: [], sizeOf: tiny });

    expect(problems).toEqual(["apps/web/public/a.png is credited but does not exist"]);
  });

  it("reports a file credited twice", () => {
    const problems = creditProblems({
      credits: [credit(), credit()],
      files: ["apps/web/public/a.png"],
      sizeOf: tiny,
    });

    expect(problems).toEqual(["apps/web/public/a.png has more than one row"]);
  });

  it.each(["CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC-BY-ND-4.0", "unknown", ""])(
    "refuses the licence %j",
    (licence) => {
      const problems = creditProblems({
        credits: [credit({ licence })],
        files: ["apps/web/public/a.png"],
        sizeOf: tiny,
      });

      expect(problems).toEqual([
        `apps/web/public/a.png has licence "${licence}", which is not on the allowed list`,
      ]);
    },
  );

  it("asks for what it is, the author, the source and the date it was added", () => {
    const problems = creditProblems({
      credits: [credit({ what: "", author: "", source: "", added: "18 October 2026" })],
      files: ["apps/web/public/a.png"],
      sizeOf: tiny,
    });

    expect(problems).toEqual([
      "apps/web/public/a.png has no what",
      "apps/web/public/a.png has no author",
      "apps/web/public/a.png has no source",
      "apps/web/public/a.png needs the date it was added as YYYY-MM-DD",
    ]);
  });

  it("refuses an SVG over 20 KB and accepts one at the limit", () => {
    const files = ["big.svg", "edge.svg"];
    const sizes = { "big.svg": MAX_SVG_BYTES + 1, "edge.svg": MAX_SVG_BYTES };

    const problems = creditProblems({
      credits: files.map((file) => credit({ file })),
      files,
      sizeOf: (file) => sizes[file],
    });

    expect(problems).toEqual(["big.svg is larger than 20 KB"]);
  });
});

describe("listFiles", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lists files in nested folders and skips hidden, installed and built folders", () => {
    dir = mkdtempSync(path.join(tmpdir(), "credits-"));
    for (const folder of ["web/public/og", "web/node_modules/x", "web/dist", "web/.cache"]) {
      mkdirSync(path.join(dir, folder), { recursive: true });
      writeFileSync(path.join(dir, folder, "a.png"), "12345");
    }
    writeFileSync(path.join(dir, "web/b.svg"), "<svg/>");

    expect(listFiles({ root: dir, folder: "web" })).toEqual(["web/b.svg", "web/public/og/a.png"]);
    expect(fileSize({ root: dir, file: "web/public/og/a.png" })).toBe(5);
  });
});
