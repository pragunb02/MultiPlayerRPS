import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleReport, bundleReportOf, codeBySource, decodeSegment, moduleName } from "./bundleReport.mjs";

const ROOT = "/repo/apps/web";
const OUT = "/repo/apps/web/dist";

describe("decodeSegment: one source map segment", () => {
  it("reads base64 VLQ numbers, small, negative and multi-digit", () => {
    expect(decodeSegment("AAAA")).toEqual([0, 0, 0, 0]);
    expect(decodeSegment("CACD")).toEqual([1, 0, 1, -1]);
    expect(decodeSegment("gBAAA")).toEqual([16, 0, 0, 0]);
  });
});

describe("codeBySource: a chunk's code split by the file that made it", () => {
  it("gives each source its columns, across lines, and leaves out code with no source", () => {
    // Line 1: columns 0 to 3 from source 0, 4 to 6 with no source, 7 on from source 1. Line 2: all source 1.
    const map = { sources: ["a.js", "b.js"], mappings: "AAAA,I,GCAA;AAAA" };

    expect(codeBySource("aaaa...bbb\nbb", map)).toEqual(
      new Map([
        [0, "aaaa"],
        [1, "bbbbb"],
      ]),
    );
  });

  it("copes with a map that names more lines than the code has", () => {
    expect(codeBySource("x", { sources: ["a.js"], mappings: "AAAA;AAAA" })).toEqual(new Map([[0, "x"]]));
  });
});

describe("moduleName", () => {
  it("names app files from the web app's folder and dependencies from node_modules", () => {
    expect(moduleName("/repo/apps/web/src/main.jsx", ROOT)).toBe("src/main.jsx");
    expect(moduleName("/repo/node_modules/chess.js/dist/esm/chess.js", ROOT)).toBe(
      "node_modules/chess.js/dist/esm/chess.js",
    );
    expect(moduleName("\0vite/preload-helper.js", ROOT)).toBe("vite/preload-helper.js");
    expect(moduleName("/repo/apps/web/src/a.module.css?used", ROOT)).toBe("src/a.module.css");
  });
});

const BUNDLE = {
  "assets/index-a.js": {
    type: "chunk",
    fileName: "assets/index-a.js",
    isEntry: true,
    isDynamicEntry: false,
    facadeModuleId: "/repo/apps/web/index.html",
    imports: ["assets/react-b.js"],
    dynamicImports: ["assets/Play-c.js"],
    viteMetadata: { importedCss: new Set(["assets/index-c.css"]) },
    code: "aaaabbb",
    map: { sources: ["../../src/main.jsx", "../../../../node_modules/react/index.js"], mappings: "AAAA,IC" },
    modules: {},
  },
  "assets/Play-c.js": {
    type: "chunk",
    fileName: "assets/Play-c.js",
    isEntry: false,
    isDynamicEntry: true,
    facadeModuleId: null,
    imports: [],
    dynamicImports: [],
    code: "",
    modules: {
      "/repo/apps/web/src/Play.jsx": { code: "play()", renderedLength: 6 },
      "/repo/x.js": { code: null },
    },
  },
  "assets/index-c.css": { type: "asset", fileName: "assets/index-c.css" },
};

describe("bundleReportOf: what the bundle check reads (CC-322)", () => {
  it("lists every chunk with its imports, CSS and the size of each source in it", () => {
    const report = bundleReportOf(BUNDLE, { root: ROOT, outDir: OUT });

    expect(report.chunks).toHaveLength(2);
    const [entry, play] = report.chunks;
    expect(entry).toMatchObject({
      file: "assets/index-a.js",
      isEntry: true,
      facade: "index.html",
      imports: ["assets/react-b.js"],
      dynamicImports: ["assets/Play-c.js"],
      css: ["assets/index-c.css"],
    });
    expect(entry.modules.map(({ name, bytes }) => [name, bytes])).toEqual([
      ["src/main.jsx", 4],
      ["node_modules/react/index.js", 3],
    ]);
    expect(entry.modules[0].gzip).toBeGreaterThan(0);
    // Without a source map it falls back to Rollup's own module code.
    expect(play).toMatchObject({ facade: null, css: [] });
    expect(play.modules.map(({ name, bytes }) => [name, bytes])).toEqual([["src/Play.jsx", 6]]);
  });
});

describe("bundleReport: the Vite plugin", () => {
  it("writes the report after a build, to a file outside the built site", () => {
    const folder = mkdtempSync(join(tmpdir(), "cc322-report-"));
    const file = join(folder, "nested", "report.json");
    const plugin = bundleReport({ file });

    plugin.configResolved({ root: ROOT, build: { outDir: "dist" } });
    plugin.generateBundle({}, BUNDLE);

    expect(plugin.apply).toBe("build");
    expect(JSON.parse(readFileSync(file, "utf8")).chunks[0].modules[0].name).toBe("src/main.jsx");
    rmSync(folder, { recursive: true, force: true });
  });
});
