// Entry point for the backup commands. It only wires the real MongoDB driver, processes and clock into the
// command line in scripts/backup/cli.mjs, where the behaviour lives and is tested.
import { spawn } from "node:child_process";

import { createBackupCli } from "../backup/cli.mjs";

const run = createBackupCli({
  // Loaded on first use, so the config command runs in the workflow before npm ci has installed the driver.
  connect: async (uri) => {
    const { MongoClient } = await import("mongodb");
    return MongoClient.connect(uri, { serverSelectionTimeoutMS: 20_000, appName: "classicade-backup" });
  },
  spawn,
  now: () => new Date(),
});

process.exitCode = await run({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
});
