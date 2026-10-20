// Entry point for `npm run test:visual` and `npm run test:visual:update` (CC-155). It only starts Docker with the
// arguments from scripts/visual/docker.mjs, where the behaviour lives and is tested.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dockerArgs, parseArgs } from "../visual/docker.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { update } = parseArgs(process.argv.slice(2));
const result = spawnSync(
  "docker",
  dockerArgs({ repo, update, uid: process.getuid(), gid: process.getgid() }),
  {
    stdio: "inherit",
  },
);
if (result.error) {
  process.stderr.write(`docker could not start: ${result.error.message}. The baselines need Docker.\n`);
}
process.exitCode = result.status ?? 1;
