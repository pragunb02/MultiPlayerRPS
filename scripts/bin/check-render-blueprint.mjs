// Entry point for the CI job that checks render.yaml against Render's published schema. It only wires the real
// file, network and output into scripts/render/blueprintSchema.mjs, where the behaviour lives and is tested.
import { readFile } from "node:fs/promises";

import { runBlueprintCheck } from "../render/blueprintSchema.mjs";

process.exitCode = await runBlueprintCheck({
  readBlueprint: () => readFile(new URL("../../render.yaml", import.meta.url), "utf8"),
  fetch: globalThis.fetch,
  stdout: process.stdout,
  stderr: process.stderr,
});
