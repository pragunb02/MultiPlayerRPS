import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Guards the guardrail: proves the layer rules in eslint.config.js reject illegal imports
// and accept legal ones (docs/ENGINEERING.md §1).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// ESLint runs in a worker thread. The real config loads the local rules in eslint-rules/ outside the test runner.
// Loaded in this thread, that second copy of the rule files would spoil their coverage report (CC-125).
const LINT_WORKER = `
  const { parentPort, workerData } = require("node:worker_threads");
  const ready = import("eslint").then(({ ESLint }) => new ESLint({ cwd: workerData.cwd }));
  parentPort.on("message", async ({ id, filePath, source }) => {
    try {
      const [result] = await (await ready).lintText(source, { filePath });
      parentPort.postMessage({ id, messages: result.messages.map(({ ruleId, message }) => ({ ruleId, message })) });
    } catch (error) {
      parentPort.postMessage({ id, error: String(error) });
    }
  });
`;
let worker;
let nextId = 0;

beforeAll(() => {
  worker = new Worker(LINT_WORKER, { eval: true, workerData: { cwd: repoRoot } });
});

afterAll(() => worker.terminate());

async function importErrors(file, source) {
  const id = nextId++;
  const messages = await new Promise((resolve, reject) => {
    const onMessage = (reply) => {
      if (reply.id !== id) return;
      worker.off("message", onMessage);
      if (reply.error === undefined) resolve(reply.messages);
      else reject(new Error(reply.error));
    };
    worker.on("message", onMessage);
    worker.postMessage({ id, filePath: path.join(repoRoot, file), source: `${source}\n` });
  });
  return messages.filter((m) => m.ruleId?.startsWith("no-restricted"));
}

describe("server layer rules", () => {
  it.each([
    ["apps/server/src/service/http/x.js", 'import "../../persistence/userDao.js";'],
    ["apps/server/src/service/http/x.js", 'import "../../data/userAccessor.js";'],
    ["apps/server/src/domain/rooms/x.js", 'import "../../service/http/app.js";'],
    ["apps/server/src/domain/rooms/x.js", 'import "../../persistence/roomDao.js";'],
    ["apps/server/src/domain/rooms/x.js", 'import mongoose from "mongoose";'],
    ["apps/server/src/data/x.js", 'import "../domain/roomComponent.js";'],
    ["apps/server/src/persistence/x.js", 'import "../data/userAccessor.js";'],
    ["apps/server/src/utils/x.js", 'import "../models/roomCode.js";'],
    ["apps/server/src/domain/x.js", 'import "../config/index.js";'],
  ])("rejects %s → %s", async (file, source) => {
    expect(await importErrors(file, source)).toHaveLength(1);
  });

  it.each([
    ["apps/server/src/service/http/x.js", 'import "../../domain/roomComponent.js";'],
    ["apps/server/src/domain/x.js", 'import "../data/roomAccessor.js";'],
    ["apps/server/src/domain/x.js", 'import "../models/roomCode.js";'],
    ["apps/server/src/data/x.js", 'import "../persistence/roomDao.js";'],
    ["apps/server/src/persistence/x.js", 'import mongoose from "mongoose";'],
    ["apps/server/src/server.js", 'import "./persistence/roomDao.js";'],
  ])("allows %s → %s", async (file, source) => {
    expect(await importErrors(file, source)).toEqual([]);
  });
});

describe("game engine purity rules", () => {
  it.each([
    'import fs from "node:fs";',
    "export const roll = () => Math.random();",
    "export const now = () => Date.now();",
    "setTimeout(() => {}, 1);",
  ])("rejects %s", async (source) => {
    expect(await importErrors("packages/games/src/x.js", source)).toHaveLength(1);
  });

  it("allows pure code", async () => {
    expect(await importErrors("packages/games/src/x.js", "export const add = (a, b) => a + b;")).toEqual([]);
  });
});
