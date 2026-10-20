// Charts of the capacity test results (CC-289), as PNG for the pull request's evidence on the `pr-evidence` branch.
// Run with `npm run load:charts` after `npm run load:test`. It reads every scripts/load/results/*.json and writes
// one PNG per chart to LOAD_CHARTS_OUT (default a temporary folder), drawn by the Chromium the browser tests use.
// The latency charts stop at a cap, so a collapse at the end of a run does not flatten the rest. A point on the
// top line went higher, and the JSON has its real value.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { lineChart } from "../load/chart.mjs";
import { MOVE_P95_LIMIT_MS } from "../load/ramp.mjs";

const RESULTS = fileURLToPath(new URL("../load/results", import.meta.url));
const out = process.env.LOAD_CHARTS_OUT ?? path.join(os.tmpdir(), "cc289-charts");

// Smallest instance first, each size's run with computer games before its run with people only.
const order = (name) =>
  ["free", "starter", "standard"].findIndex((size) => name.startsWith(size)) * 2 +
  (name.endsWith("-people.json") ? 1 : 0);
const runs = readdirSync(RESULTS)
  .filter((name) => name.endsWith(".json"))
  .sort((a, b) => order(a) - order(b))
  .map((name) => ({
    name: name.replace(/\.json$/, ""),
    ...JSON.parse(readFileSync(path.join(RESULTS, name))),
  }));

const series = (pick) =>
  runs.map((run) => ({ name: run.name, points: run.steps.map((step) => [step.players, pick(step)]) }));
const players = "players at once (log scale)";

const charts = {
  "move-p95-vs-players": lineChart({
    title: "Move round trip p95 by players at once",
    xLabel: players,
    yLabel: "p95 move round trip (ms)",
    series: series((step) => step.moves.p95),
    limits: [{ name: `NFR-3 ${MOVE_P95_LIMIT_MS} ms`, value: MOVE_P95_LIMIT_MS }],
    logX: true,
    yMax: 600,
  }),
  "move-p50-vs-players": lineChart({
    title: "Move round trip p50 by players at once",
    xLabel: players,
    yLabel: "p50 move round trip (ms)",
    series: series((step) => step.moves.p50),
    logX: true,
    yMax: 300,
  }),
  "event-loop-vs-players": lineChart({
    title: "Worst event-loop delay p99 in a second, by players at once",
    xLabel: players,
    yLabel: "event-loop delay p99 (ms)",
    series: series((step) => step.server.loopP99Ms.max),
    logX: true,
    yMax: 1000,
  }),
  "cpu-vs-players": lineChart({
    title: "Server CPU used (mean of each second) by players at once",
    xLabel: players,
    yLabel: "CPU cores used",
    series: series((step) => step.server.cpu.mean),
    limits: [
      { name: "free 0.1 CPU", value: 0.1 },
      { name: "starter 0.5 CPU", value: 0.5 },
      { name: "standard 1 CPU", value: 1 },
    ],
    logX: true,
  }),
  "memory-vs-players": lineChart({
    title: "Server memory (peak RSS) by players at once",
    xLabel: players,
    yLabel: "RSS (MB)",
    series: series((step) => step.server.rssMb),
    limits: [{ name: "free and starter 512 MB", value: 512 }],
    logX: true,
  }),
  "mongo-ops-vs-players": lineChart({
    title: "MongoDB operations a second by players at once",
    xLabel: players,
    yLabel: "operations a second",
    series: series((step) => step.mongo.opsPerSecond.total),
    limits: [
      { name: "Atlas M0 100 a second", value: 100 },
      { name: "Atlas Flex 500 a second", value: 500 },
    ],
    logX: true,
  }),
};

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  for (const [name, svg] of Object.entries(charts)) {
    await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
    writeFileSync(path.join(out, `${name}.png`), await page.locator("svg").screenshot());
  }
} finally {
  await browser.close();
}
process.stdout.write(`${Object.keys(charts).length} charts in ${out}\n`);
