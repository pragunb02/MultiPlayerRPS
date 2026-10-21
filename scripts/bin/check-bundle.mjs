// The bundle size check (CC-135, CC-322): run after `npm run build:web`, it fails when the first route or an effect
// is over its budget. The rules live in scripts/build/bundleBudget.mjs, where they are tested. This file only reads
// the build, and the effect registry once it exists.
//
//   node scripts/bin/check-bundle.mjs [--dist apps/web/dist] [--report apps/web/bundle-report.json]
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { checkBundle, effectBudgetsOf, gzipSize } from "../build/bundleBudget.mjs";

const repo = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: {
    dist: { type: "string", default: join(repo, "apps/web/dist") },
    report: { type: "string", default: join(repo, "apps/web/bundle-report.json") },
    registry: { type: "string", default: join(repo, "apps/web/src/effects/registry.js") },
  },
});

const report = JSON.parse(readFileSync(values.report, "utf8"));
const html = readFileSync(join(values.dist, "index.html"), "utf8");
const effectBudgets = existsSync(values.registry)
  ? effectBudgetsOf((await import(pathToFileURL(values.registry).href)).EFFECTS)
  : new Map();

const result = checkBundle({
  html,
  report,
  gzipOf: (file) => gzipSize(readFileSync(join(values.dist, file))),
  effectBudgets,
});
const out = result.ok ? process.stdout : process.stderr;
out.write(`${result.lines.join("\n")}\n`);
out.write(result.ok ? "bundle check passed\n" : "bundle check failed (docs/tickets/CC-322.md)\n");
process.exitCode = result.ok ? 0 : 1;
