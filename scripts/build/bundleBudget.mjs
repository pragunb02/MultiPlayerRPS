import { gzipSync } from "node:zlib";

/**
 * The budgets the bundle size check enforces, in kB of gzip (1 kB is 1000 bytes, as Vite reports sizes).
 * `firstRouteKB` is LOOK_AND_FEEL section 2.1 and the vision's section 6.11 (CC-135). The effect budgets are
 * ADR-075's (docs/design/EFFECTS-STACK.md, section 9).
 */
export const BUDGETS = Object.freeze({
  firstRouteKB: 150,
  registryKB: 0.5,
  effectKB: 6,
  particlesKB: 1.5,
});

/** The effect registry, the only part of the effects allowed on the first route (ADR-075). */
export const EFFECT_REGISTRY = "src/effects/registry.js";

/** The shared canvas module the effect scenes use (ADR-075). */
export const PARTICLES = "src/effects/particles.js";

/** A scene or a theme of the effect registry: each is its own lazy chunk and never on the first route. */
export const isEffect = (name) => /^src\/effects\/(scenes|themes)\//.test(name);

/**
 * Libraries only some pages need, which must never be in the first route again: chess.js leaked into it once
 * through one helper import (CC-322), and Motion is for the boards only (ADR-075).
 */
export const NEVER_ON_FIRST_ROUTE = Object.freeze([
  "node_modules/chess.js/",
  "node_modules/motion/",
  "node_modules/framer-motion/",
  "node_modules/motion-dom/",
]);

const kB = (bytes) => bytes / 1000;
const show = (bytes) => `${kB(bytes).toFixed(2)} kB`;

/**
 * The JavaScript files the browser downloads before it can show the first page: the entry script of index.html
 * and every file it preloads with `<link rel="modulepreload">`, in the page's order.
 *
 * @param {string} html  the built index.html
 * @returns {string[]} paths from the site's root, without the leading slash
 */
export function firstRouteFiles(html) {
  const entries = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="\/([^"]+)"/g)].map(
    (match) => match[1],
  );
  const preloads = [...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/([^"]+)"/g)].map(
    (match) => match[1],
  );
  return [...entries, ...preloads];
}

/**
 * The gzip size of a file's bytes, as Vite's report counts it.
 *
 * @param {Buffer | string} contents
 */
export const gzipSize = (contents) => gzipSync(contents).length;

/**
 * Checks a production build against the budgets (CC-135, CC-322, ADR-075). It fails when:
 *
 * 1. The first route, the entry script and its preloads, is over `firstRouteKB` of gzip.
 * 2. A library in `NEVER_ON_FIRST_ROUTE`, or an effect scene or theme, is in a first route chunk.
 * 3. The effect registry's own code on the first route is over `registryKB`.
 * 4. An effect's own chunk, with the CSS it brings, is over `effectKB`, or over the smaller `budgetKB` its
 *    registry entry gives.
 * 5. The shared particle module's chunk is over `particlesKB`.
 *
 * Until the effect registry exists (CC-099), rules 3 to 5 have nothing to check and pass.
 *
 * @param {{
 *   html: string,
 *   report: { chunks: ReadonlyArray<{ file: string, isDynamicEntry: boolean, facade: string | null, imports: string[],
 *     css: string[], modules: ReadonlyArray<{ name: string, gzip: number }> }> },
 *   gzipOf: (file: string) => number,
 *   effectBudgets?: ReadonlyMap<string, number>,
 *   budgets?: typeof BUDGETS,
 * }} build  `gzipOf` gives a built file's gzip size by its path in dist. `effectBudgets` gives each effect's
 *   `budgetKB` by its module name, such as `src/effects/scenes/winBurst.js`
 * @returns {{ ok: boolean, lines: string[], firstRoute: ReadonlyArray<{ file: string, gzip: number }> }} `lines` say
 *   what was measured, each failure first with "FAIL"
 */
export function checkBundle({ html, report, gzipOf, effectBudgets = new Map(), budgets = BUDGETS }) {
  const failures = [];
  const notes = [];
  const chunkOf = new Map(report.chunks.map((chunk) => [chunk.file, chunk]));

  const files = firstRouteFiles(html);
  if (files.length === 0) {
    failures.push("FAIL index.html loads no module script, so the first route cannot be measured");
  }
  const firstRoute = files.map((file) => ({ file, gzip: gzipOf(file) }));
  const total = firstRoute.reduce((sum, { gzip }) => sum + gzip, 0);
  const firstRouteLine = `first route: ${show(total)} gzip in ${files.length} files, budget ${budgets.firstRouteKB} kB`;
  if (kB(total) > budgets.firstRouteKB) {
    failures.push(`FAIL ${firstRouteLine}, ${show(total - budgets.firstRouteKB * 1000)} over`);
  } else {
    notes.push(firstRouteLine);
  }
  for (const { file, gzip } of firstRoute) {
    notes.push(`  ${show(gzip).padStart(10)}  ${file}`);
  }

  const firstModules = files.flatMap((file) => chunkOf.get(file)?.modules ?? []);
  for (const module of firstModules) {
    const library = NEVER_ON_FIRST_ROUTE.find((prefix) => module.name.startsWith(prefix));
    if (library !== undefined) {
      failures.push(`FAIL ${module.name} is on the first route (${library} must load only where it is used)`);
    }
    if (isEffect(module.name)) {
      failures.push(`FAIL ${module.name} is on the first route (each effect must be its own lazy chunk)`);
    }
  }

  const registry = firstModules
    .filter((module) => module.name === EFFECT_REGISTRY)
    .reduce((sum, module) => sum + module.gzip, 0);
  if (kB(registry) > budgets.registryKB) {
    failures.push(
      `FAIL the effect registry is ${show(registry)} on the first route, budget ${budgets.registryKB} kB`,
    );
  } else if (registry > 0) {
    notes.push(`effect registry on the first route: ${show(registry)}, budget ${budgets.registryKB} kB`);
  }

  for (const chunk of report.chunks) {
    const ownSize = () => gzipOf(chunk.file) + chunk.css.reduce((sum, css) => sum + gzipOf(css), 0);
    if (chunk.isDynamicEntry && chunk.facade !== null && isEffect(chunk.facade)) {
      const budget = Math.min(budgets.effectKB, effectBudgets.get(chunk.facade) ?? budgets.effectKB);
      const size = ownSize();
      const line = `effect ${chunk.facade}: ${show(size)} with its CSS, budget ${budget} kB`;
      notes.push(line);
      if (kB(size) > budget) {
        failures.push(`FAIL ${line}`);
      }
    }
    if (chunk.modules.some((module) => module.name === PARTICLES)) {
      const size = gzipOf(chunk.file);
      const line = `particle module chunk ${chunk.file}: ${show(size)}, budget ${budgets.particlesKB} kB`;
      notes.push(line);
      if (kB(size) > budgets.particlesKB) {
        failures.push(`FAIL ${line}`);
      }
    }
  }

  return { ok: failures.length === 0, lines: [...failures, ...notes], firstRoute };
}

/**
 * Each effect's `budgetKB` from the effect registry's entries, by the module its `load()` imports. The module is
 * read from the loader's own text, `() => import("./scenes/winBurst.js")`, so the registry need not be run.
 *
 * @param {ReadonlyArray<{ budgetKB?: number, load: () => unknown }>} effects  the registry's `EFFECTS`
 * @returns {Map<string, number>}
 */
export function effectBudgetsOf(effects) {
  const budgets = new Map();
  for (const effect of effects) {
    const target = /import\(\s*["']\.\/([^"']+)["']\s*\)/.exec(String(effect.load))?.[1];
    if (target !== undefined && typeof effect.budgetKB === "number") {
      budgets.set(`src/effects/${target}`, effect.budgetKB);
    }
  }
  return budgets;
}
