import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

// Guards the guardrail: proves the layer rules in eslint.config.js reject illegal imports
// and accept legal ones (docs/ENGINEERING.md §1).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let eslint;

beforeAll(() => {
  eslint = new ESLint({ cwd: repoRoot });
});

async function importErrors(file, source) {
  const [result] = await eslint.lintText(`${source}\n`, { filePath: path.join(repoRoot, file) });
  return result.messages.filter((m) => m.ruleId?.startsWith("no-restricted"));
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
