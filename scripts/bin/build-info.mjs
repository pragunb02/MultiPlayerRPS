// The last step of `npm run build:web` (CC-303). It only wires git, the environment and the file into
// scripts/build/buildInfo.mjs, where the behaviour lives and is tested. git runs without a shell, with the commit as
// one argument that buildInfo.mjs has already checked to be a sha.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { buildInfoFor } from "../build/buildInfo.mjs";

const info = buildInfoFor({
  env: process.env,
  commitDateOf: (commit) =>
    execFileSync("git", ["show", "-s", "--format=%cI", commit], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
});
writeFileSync(new URL("../../apps/server/build-info.json", import.meta.url), `${JSON.stringify(info)}\n`);
process.stdout.write(`build info: commit ${info.commit}, version ${info.version}\n`);
