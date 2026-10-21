import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUDGETS, checkBundle, effectBudgetsOf, firstRouteFiles, gzipSize } from "./bundleBudget.mjs";

const HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-a.js"></script>
<link rel="modulepreload" crossorigin href="/assets/react-b.js">
<link rel="stylesheet" crossorigin href="/assets/index-c.css">
</head><body></body></html>`;

const chunk = (file, extra = {}) => ({
  file,
  isEntry: false,
  isDynamicEntry: false,
  facade: null,
  imports: [],
  dynamicImports: [],
  css: [],
  modules: [],
  ...extra,
});

/** A build whose files have the given gzip sizes in kB. */
function build({ sizes, chunks, html = HTML, effectBudgets }) {
  return checkBundle({
    html,
    report: { chunks },
    gzipOf: (file) => Math.round((sizes[file] ?? 0) * 1000),
    effectBudgets,
  });
}

const FIRST = [
  chunk("assets/index-a.js", { isEntry: true, modules: [{ name: "src/main.jsx", gzip: 400 }] }),
  chunk("assets/react-b.js"),
];

describe("firstRouteFiles: what the browser downloads before the first page", () => {
  it("is the entry script and every module it preloads, never the stylesheets", () => {
    expect(firstRouteFiles(HTML)).toEqual(["assets/index-a.js", "assets/react-b.js"]);
  });
});

describe("checkBundle: the bundle size check (CC-135, CC-322, ADR-075)", () => {
  it("passes a first route under 150 kB and says what it measured", () => {
    const result = build({ sizes: { "assets/index-a.js": 140, "assets/react-b.js": 3.3 }, chunks: FIRST });

    expect(result.ok).toBe(true);
    expect(result.lines[0]).toBe("first route: 143.30 kB gzip in 2 files, budget 150 kB");
    expect(result.firstRoute).toEqual([
      { file: "assets/index-a.js", gzip: 140_000 },
      { file: "assets/react-b.js", gzip: 3300 },
    ]);
  });

  it("fails a first route over 150 kB with the entry and its preloads together", () => {
    const result = build({ sizes: { "assets/index-a.js": 148, "assets/react-b.js": 3 }, chunks: FIRST });

    expect(result.ok).toBe(false);
    expect(result.lines[0]).toBe("FAIL first route: 151.00 kB gzip in 2 files, budget 150 kB, 1.00 kB over");
  });

  it("fails a build whose index.html loads no script, which it cannot measure", () => {
    const result = build({ sizes: {}, chunks: [], html: "<html></html>" });

    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatch(/^FAIL index.html loads no module script/);
  });

  it("fails when chess.js or Motion is on the first route again", () => {
    const chunks = [
      chunk("assets/index-a.js", {
        modules: [
          { name: "node_modules/chess.js/dist/esm/chess.js", gzip: 11_600 },
          { name: "node_modules/motion-dom/dist/es/index.mjs", gzip: 900 },
        ],
      }),
    ];

    const result = build({ sizes: { "assets/index-a.js": 50 }, chunks });

    expect(result.ok).toBe(false);
    expect(result.lines.filter((line) => line.startsWith("FAIL"))).toEqual([
      "FAIL node_modules/chess.js/dist/esm/chess.js is on the first route (node_modules/chess.js/ must load only where it is used)",
      "FAIL node_modules/motion-dom/dist/es/index.mjs is on the first route (node_modules/motion-dom/ must load only where it is used)",
    ]);
  });

  it("fails an effect scene or theme on the first route, and a registry over 0.5 kB there", () => {
    const chunks = [
      chunk("assets/index-a.js", {
        modules: [
          { name: "src/effects/registry.js", gzip: 600 },
          { name: "src/effects/scenes/winBurst.js", gzip: 200 },
        ],
      }),
    ];

    const result = build({ sizes: { "assets/index-a.js": 50 }, chunks });

    expect(result.lines.filter((line) => line.startsWith("FAIL"))).toEqual([
      "FAIL src/effects/scenes/winBurst.js is on the first route (each effect must be its own lazy chunk)",
      "FAIL the effect registry is 0.60 kB on the first route, budget 0.5 kB",
    ]);
  });

  it("passes a registry within its budget and says its size", () => {
    const chunks = [
      chunk("assets/index-a.js", { modules: [{ name: "src/effects/registry.js", gzip: 330 }] }),
    ];

    const result = build({ sizes: { "assets/index-a.js": 50 }, chunks });

    expect(result.ok).toBe(true);
    expect(result.lines).toContain("effect registry on the first route: 0.33 kB, budget 0.5 kB");
  });

  it("counts an effect's chunk with its CSS against 6 kB, or its own smaller budget", () => {
    const effect = (name, file, css) =>
      chunk(file, { isDynamicEntry: true, facade: `src/effects/${name}`, css: [css] });
    const chunks = [
      ...FIRST,
      effect("themes/diwali2026.js", "assets/diwali.js", "assets/diwali.css"),
      effect("scenes/winBurst.js", "assets/win.js", "assets/win.css"),
      effect("scenes/sparks.js", "assets/sparks.js", "assets/sparks.css"),
    ];
    const sizes = {
      "assets/index-a.js": 100,
      "assets/diwali.js": 5,
      "assets/diwali.css": 1.5,
      "assets/win.js": 1.8,
      "assets/win.css": 0.4,
      "assets/sparks.js": 1,
      "assets/sparks.css": 0.2,
    };

    const result = build({
      sizes,
      chunks,
      effectBudgets: new Map([["src/effects/scenes/winBurst.js", 2]]),
    });

    expect(result.lines.filter((line) => line.startsWith("FAIL"))).toEqual([
      "FAIL effect src/effects/themes/diwali2026.js: 6.50 kB with its CSS, budget 6 kB",
      "FAIL effect src/effects/scenes/winBurst.js: 2.20 kB with its CSS, budget 2 kB",
    ]);
    expect(result.lines).toContain("effect src/effects/scenes/sparks.js: 1.20 kB with its CSS, budget 6 kB");
  });

  it("holds the shared particle module's chunk to 1.5 kB", () => {
    const particles = (file) => chunk(file, { modules: [{ name: "src/effects/particles.js", gzip: 700 }] });

    const over = build({
      sizes: { "assets/index-a.js": 9, "assets/p.js": 1.6 },
      chunks: [particles("assets/p.js")],
    });
    const under = build({
      sizes: { "assets/index-a.js": 9, "assets/p.js": 0.8 },
      chunks: [particles("assets/p.js")],
    });

    expect(over.lines[0]).toBe("FAIL particle module chunk assets/p.js: 1.60 kB, budget 1.5 kB");
    expect(under.ok).toBe(true);
  });

  it("uses ADR-075's budgets", () => {
    expect(BUDGETS).toEqual({ firstRouteKB: 150, registryKB: 0.5, effectKB: 6, particlesKB: 1.5 });
  });
});

describe("effectBudgetsOf: each effect's own budget, read from the registry", () => {
  it("maps the module each entry loads to its budgetKB, and skips entries without one", () => {
    // The loaders' text, as Node reads the registry. The test runner would rewrite a real `import()` here.
    const loader = (text) => ({ toString: () => text });
    const effects = [
      { budgetKB: 2, load: loader('() => import("./scenes/winBurst.js")') },
      { budgetKB: 6, load: loader("() => import('./themes/diwali2026.js')") },
      { load: loader('() => import("./scenes/sparks.js")') },
      { budgetKB: 1, load: loader("() => Promise.resolve({})") },
    ];

    expect(effectBudgetsOf(effects)).toEqual(
      new Map([
        ["src/effects/scenes/winBurst.js", 2],
        ["src/effects/themes/diwali2026.js", 6],
      ]),
    );
  });
});

describe("check-bundle.mjs: the CI step, run on a fake build (CC-322)", () => {
  let folder;
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  /** A built site whose entry script is `kB` of bytes that do not compress. */
  function fakeBuild(kB) {
    folder = mkdtempSync(join(tmpdir(), "cc322-bundle-"));
    mkdirSync(join(folder, "dist/assets"), { recursive: true });
    writeFileSync(
      join(folder, "dist/index.html"),
      '<script type="module" src="/assets/index-a.js"></script>',
    );
    writeFileSync(join(folder, "dist/assets/index-a.js"), randomBytes(kB * 1000));
    const report = { chunks: [chunk("assets/index-a.js", { isEntry: true })] };
    writeFileSync(join(folder, "report.json"), JSON.stringify(report));
  }

  function run() {
    const script = new URL("../bin/check-bundle.mjs", import.meta.url).pathname;
    const args = [script, "--dist", join(folder, "dist"), "--report", join(folder, "report.json")];
    return execFileSync(process.execPath, [...args, "--registry", join(folder, "none.js")], {
      encoding: "utf8",
      stdio: "pipe",
    });
  }

  it("fails an oversized build with a non-zero exit and says by how much", () => {
    fakeBuild(160);

    let failure;
    try {
      run();
    } catch (error) {
      failure = error;
    }

    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatch(/^FAIL first route: 16\d\.\d\d kB gzip in 1 files, budget 150 kB/);
    expect(failure.stderr).toContain("bundle check failed");
  });

  it("passes a build within budget", () => {
    fakeBuild(20);

    expect(run()).toContain("bundle check passed");
  });

  it("measures gzip as Node's zlib does", () => {
    expect(gzipSize("a".repeat(1000))).toBeLessThan(40);
  });
});
