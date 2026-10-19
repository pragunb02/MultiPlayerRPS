// The capacity test (CC-289), run with `npm run load:test`. It builds the production image from our Dockerfile,
// runs it with a Render size's CPU and memory limits beside a local MongoDB (pinned as in CC-288), and ramps
// simulated players up in steps until the move p95 passes 150 ms (NFR-3) or anything fails. It only ever talks to
// 127.0.0.1, never to production. Every container and network it starts is named with this run's id and removed at
// the end, and nothing else is touched.
//
// Settings come from the environment:
// 1. LOAD_SIZE: free (default, 0.1 CPU and 512 MB), starter (0.5 CPU, 512 MB) or standard (1 CPU, 2 GB).
// 2. LOAD_STEPS: players at once per step, such as 10,20,40 (default scripts/load/ramp.mjs DEFAULT_STEPS).
// 3. LOAD_STEP_S: seconds per step (default 60), of which LOAD_WARMUP_S (default 15) are not measured.
// 4. LOAD_IDLE_S: seconds the server is left alone after it starts, and then measured with nobody on it (default 30).
// 5. LOAD_SEED: the random seed of the players (default 289). LOAD_PORT: the local port (default 4977).
// 6. LOAD_COMPUTER_SHARE: the share of players who play a computer character (default 0.4, scripts/load/model.mjs).
// 7. LOAD_STOP: nfr3 (default) stops at the first step over NFR-3 or with a failure. unplayable goes on past NFR-3
//    until a failure or a move p95 over LOAD_UNPLAYABLE_MS (default 1000), to show how the server degrades.
// 8. LOAD_OUT: where the results go (default scripts/load/results/<size>.json).
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { MongoClient } from "mongodb";

import { createSeededRng } from "../../packages/games/src/rng.js";
import { DEFAULT_MODEL } from "../load/model.mjs";
import { parseProbeLines } from "../load/probe.mjs";
import { opsPerSecond, parseSteps, RENDER_SIZES, serverSummary, verdict } from "../load/ramp.mjs";
import { createRecorder } from "../load/stats.mjs";
import { createSwarm } from "../load/swarm.mjs";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
// The exact image CC-288 pins for Docker and CI, never a floating tag.
const MONGO_IMAGE = "mongo:8.2.12@sha256:e0ce8c35124d4a9f9785532d1f268f39e9728ffa1cb38f46fa482436424c4bd3";
const APP_IMAGE = "classicade-load:cc-289";

const sizeName = process.env.LOAD_SIZE ?? "free";
const size = RENDER_SIZES[sizeName];
if (size === undefined) {
  throw new RangeError(`LOAD_SIZE must be one of ${Object.keys(RENDER_SIZES).join(", ")}`);
}
const steps = parseSteps(process.env.LOAD_STEPS);
const stepSeconds = Number(process.env.LOAD_STEP_S ?? 60);
const warmupSeconds = Number(process.env.LOAD_WARMUP_S ?? 15);
const seed = Number(process.env.LOAD_SEED ?? 289);
const idleSeconds = Number(process.env.LOAD_IDLE_S ?? 30);
const stop = process.env.LOAD_STOP ?? "nfr3";
if (!["nfr3", "unplayable"].includes(stop)) {
  throw new RangeError("LOAD_STOP must be nfr3 or unplayable");
}
const unplayableMs = Number(process.env.LOAD_UNPLAYABLE_MS ?? 1000);
const model = {
  ...DEFAULT_MODEL,
  computerShare: Number(process.env.LOAD_COMPUTER_SHARE ?? DEFAULT_MODEL.computerShare),
};
const port = Number(process.env.LOAD_PORT ?? 4977);
const mongoPort = port + 1;
const out = process.env.LOAD_OUT ?? path.join(ROOT, "scripts/load/results", `${sizeName}.json`);
const base = `http://127.0.0.1:${port}`;

const id = `cc289-${process.pid}`;
const names = { network: id, mongo: `${id}-mongo`, app: `${id}-app` };
const say = (line) => process.stdout.write(`${line}\n`);
const docker = (...args) => run("docker", args, { maxBuffer: 64 * 1024 * 1024 });

async function waitFor(what, check, tries = 120) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await check().catch(() => false)) return;
    await sleep(500);
  }
  throw new Error(`${what} did not start`);
}

/** Docker's own reading of the app container, a check on the probe's numbers. */
async function dockerStats() {
  const { stdout } = await docker("stats", "--no-stream", "--format", "{{json .}}", names.app);
  const { CPUPerc, MemUsage } = JSON.parse(stdout);
  return { cpuPercentOfOneCore: Number.parseFloat(CPUPerc), memory: MemUsage };
}

async function main() {
  say(`CC-289 load test: ${sizeName} (${size.cpus} CPU, ${size.memory}), steps ${steps.join(", ")}`);
  say("building the production image from the Dockerfile");
  await docker("build", "--quiet", "-t", APP_IMAGE, ROOT);
  await docker("network", "create", names.network);
  await docker(
    "run",
    ...["-d", "--rm", "--name", names.mongo, "--network", names.network],
    ...["-p", `127.0.0.1:${mongoPort}:27017`, MONGO_IMAGE],
  );
  const mongo = new MongoClient(`mongodb://127.0.0.1:${mongoPort}/?directConnection=true`);
  await waitFor("MongoDB", async () => (await mongo.db("admin").command({ ping: 1 })).ok === 1);

  await docker(
    "run",
    ...["-d", "--rm", "--name", names.app, "--network", names.network],
    ...["--cpus", size.cpus, "--memory", size.memory, "-p", `127.0.0.1:${port}:4000`],
    ...["-e", "NODE_ENV=production", "-e", "LOG_LEVEL=warn", "-e", `ALLOWED_ORIGINS=${base}`],
    ...["-e", `MONGO_URI=mongodb://${names.mongo}:27017/load`],
    // A new random secret for each run, so nothing secret is ever written down.
    ...["-e", `SESSION_SECRET=${randomBytes(32).toString("hex")}`],
    ...["-v", `${path.join(ROOT, "scripts/load")}:/app/scripts/load:ro`],
    ...["-v", `${path.join(ROOT, "scripts/bin/load-serve.mjs")}:/app/scripts/bin/load-serve.mjs:ro`],
    ...[APP_IMAGE, "node", "scripts/bin/load-serve.mjs"],
  );
  await waitFor("The server", async () => (await fetch(`${base}/health`)).ok);

  const readings = [];
  const serverLines = [];
  const logs = spawn("docker", ["logs", "-f", names.app]);
  let pending = "";
  const onOutput = (chunk) => {
    const text = pending + chunk.toString();
    const cut = text.lastIndexOf("\n");
    pending = text.slice(cut + 1);
    const whole = text.slice(0, cut + 1);
    readings.push(...parseProbeLines(whole));
    serverLines.push(...whole.split("\n").filter((line) => line.startsWith("{")));
  };
  logs.stdout.on("data", onOutput);
  logs.stderr.on("data", onOutput);

  const harnessLoop = monitorEventLoopDelay({ resolution: 10 });
  harnessLoop.enable();
  const recorder = createRecorder();
  const swarm = createSwarm({ base, recorder, rng: createSeededRng(seed), model });
  const results = [];
  const opcounters = async () => (await mongo.db("admin").command({ serverStatus: 1 })).opcounters;
  let idle;
  try {
    // The server's own cost with nobody on it: its timers, the probe and MongoDB's housekeeping.
    await sleep(idleSeconds * 1000);
    const idleFrom = Date.now();
    const idleOps = await opcounters();
    await sleep(idleSeconds * 1000);
    idle = {
      seconds: idleSeconds,
      server: serverSummary(readings.filter((reading) => reading.at >= idleFrom)),
      mongo: { opsPerSecond: opsPerSecond(idleOps, await opcounters(), (Date.now() - idleFrom) / 1000) },
    };
    say(
      `idle: cpu ${idle.server.cpu.mean}, loop p99 ${idle.server.loopP99Ms.max} ms, rss ${idle.server.rssMb} MB`,
    );
    for (const players of steps) {
      await swarm.grow(players, 10_000);
      await sleep(warmupSeconds * 1000);
      recorder.take();
      harnessLoop.reset();
      const from = Date.now();
      const opsBefore = await opcounters();
      const linesBefore = serverLines.length;
      await sleep(((stepSeconds - warmupSeconds) * 1000) / 2);
      const stats = await dockerStats().catch((err) => ({ error: err.message }));
      await sleep(((stepSeconds - warmupSeconds) * 1000) / 2);
      const seconds = (Date.now() - from) / 1000;
      const opsAfter = await opcounters();
      const { connections } = await mongo.db("admin").command({ serverStatus: 1 });
      const taken = recorder.take();
      const warnings = serverLines.slice(linesBefore).map((line) => {
        const { level, msg } = JSON.parse(line);
        return `${level} ${msg}`;
      });
      const step = {
        players,
        connected: swarm.players(),
        seconds: Math.round(seconds),
        movesPerSecond: Math.round((taken.moves.count / seconds) * 10) / 10,
        gamesPerSecond:
          Math.round(
            (Object.entries(taken.counts)
              .filter(([name]) => name.startsWith("games "))
              .reduce((sum, [, count]) => sum + count, 0) /
              seconds) *
              100,
          ) / 100,
        ...taken,
        server: serverSummary(readings.filter((reading) => reading.at >= from)),
        mongo: { opsPerSecond: opsPerSecond(opsBefore, opsAfter, seconds), connections: connections.current },
        docker: stats,
        serverWarnings: Object.fromEntries(
          [...new Set(warnings)].map((line) => [line, warnings.filter((w) => w === line).length]),
        ),
        harnessLoopP99Ms: Math.round(harnessLoop.percentile(99) / 1e5) / 10,
      };
      step.verdict = verdict(step);
      step.playable = verdict(step, { moveP95LimitMs: unplayableMs });
      results.push(step);
      say(
        `${players} players (${step.connected} connected): move p50 ${step.moves.p50} p95 ${step.moves.p95} ` +
          `p99 ${step.moves.p99} ms, ${step.movesPerSecond} moves/s, loop p99 ${step.server.loopP99Ms.max} ms, ` +
          `cpu ${step.server.cpu.mean}, rss ${step.server.rssMb} MB, mongo ${step.mongo.opsPerSecond.total} ops/s` +
          (step.verdict.broken ? ` OVER NFR-3: ${step.verdict.reasons.join("; ")}` : ""),
      );
      if ((stop === "nfr3" ? step.verdict : step.playable).broken) break;
    }
  } finally {
    await swarm.stop();
    logs.kill();
    await mongo.close();
  }
  // The capacity is the last step before the first break, never a later step that happened to pass.
  const before = (key) => {
    const first = results.findIndex((step) => step[key].broken);
    return { held: first === -1 ? results.at(-1) : results[first - 1], broke: results[first] };
  };
  const { held, broke } = before("verdict");
  const playable = before("playable");
  const report = {
    ticket: "CC-289",
    date: new Date().toISOString(),
    size: { name: sizeName, ...size },
    settings: { steps, stepSeconds, warmupSeconds, idleSeconds, seed, stop, unplayableMs, model },
    machine: {
      node: process.version,
      cpus: os.cpus().length,
      platform: process.platform,
      arch: process.arch,
    },
    images: { app: "built from Dockerfile", mongo: MONGO_IMAGE },
    capacity: {
      playersAtOnce: held?.players ?? 0,
      movesPerSecond: held?.movesPerSecond ?? 0,
      gamesPerSecond: held?.gamesPerSecond ?? 0,
      brokeAt: broke?.players ?? null,
      reasons: broke?.verdict.reasons ?? [],
      playable: {
        limitMs: unplayableMs,
        playersAtOnce: playable.held?.players ?? 0,
        movesPerSecond: playable.held?.movesPerSecond ?? 0,
        brokeAt: playable.broke?.players ?? null,
        reasons: playable.broke?.playable.reasons ?? [],
      },
    },
    idle,
    steps: results,
  };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  say(`held ${report.capacity.playersAtOnce} players, results in ${path.relative(ROOT, out)}`);
}

/** Removes only what this run started, whatever state it was left in. */
async function cleanUp() {
  for (const container of [names.app, names.mongo]) {
    await docker("rm", "-f", container).catch(() => {});
  }
  await docker("network", "rm", names.network).catch(() => {});
}

process.once("SIGINT", () => {
  cleanUp().finally(() => process.exit(130));
});
try {
  await main();
} finally {
  await cleanUp();
}
