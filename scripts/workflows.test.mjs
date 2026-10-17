import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { BACKUP_SECRETS } from "./backup/backupConfig.mjs";
import { DOWN_STEP_NAME } from "./uptime/incident.mjs";

// The workflow files and the scripts depend on each other by name. These checks keep the two in step, and pin the
// rules that keep data out of this public repository's logs and artifacts.
const read = (/** @type {string} */ path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("uptime workflow", () => {
  it("has the step the next run looks for, running only when the site is down", async () => {
    const workflow = await read(".github/workflows/uptime.yml");

    expect(workflow).toContain(
      `      - name: ${DOWN_STEP_NAME}\n        if: always() && steps.monitor.outputs.state == 'down'`,
    );
  });

  it("runs every 10 minutes and can only write issues", async () => {
    const workflow = await read(".github/workflows/uptime.yml");

    expect(workflow).toContain('- cron: "*/10 * * * *"');
    expect(workflow).toMatch(/permissions:\n {2}contents: read\n {2}issues: write\n/);
    expect(workflow).not.toMatch(/secrets\./);
  });
});

describe("backup workflow", () => {
  it("passes every secret the config check expects", async () => {
    const workflow = await read(".github/workflows/backup.yml");

    for (const name of BACKUP_SECRETS) {
      expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
    }
  });

  it("runs every step after the config check only when backups are set up", async () => {
    const workflow = await read(".github/workflows/backup.yml");
    const steps = workflow.split("\n      - ").slice(1);
    const afterConfig = steps.slice(steps.findIndex((step) => step.includes("id: config")) + 1);

    const unguarded = afterConfig.filter(
      (step) => !step.includes("if: steps.config.outputs.ready == 'true'") && !step.includes("if: always()"),
    );

    expect(unguarded).toEqual([]);
  });

  it("never publishes anything as an artifact or cache, because both are public on this repository", async () => {
    for (const path of [".github/workflows/backup.yml", ".github/actions/backup-tools/action.yml"]) {
      const text = await read(path);
      expect(text).not.toMatch(/upload-artifact|actions\/cache|set -x|--verbose/);
    }
  });

  it("dumps quietly, so collection names and counts stay out of the log", async () => {
    expect(await read("scripts/backup/dump-and-encrypt.sh")).toMatch(/mongodump [^\n]*--quiet/);
  });
});
