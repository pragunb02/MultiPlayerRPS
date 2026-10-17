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

// Pull requests leave out the tests tagged slow and the nightly run includes them (CC-203). These checks keep the
// npm scripts, the Vitest tag and both workflows in step, so no test can drop out of both by accident.
describe("slow tests", () => {
  const scripts = async () => JSON.parse(await read("package.json")).scripts;

  it("are declared as a Vitest tag, so a misspelt tag fails instead of hiding a test", async () => {
    expect(await read("vitest.config.mjs")).toMatch(/tags: \[\s*\{\s*name: "slow",/);
  });

  it("are left out of every pull request command and nowhere else", async () => {
    const { test, "test:coverage": coverage, "test:all": all } = await scripts();

    expect(test).toBe('vitest run --tags-filter="not slow"');
    expect(coverage).toBe('vitest run --coverage --tags-filter="not slow"');
    expect(all).toBe("vitest run --coverage");
    expect(await read(".github/workflows/ci.yml")).toContain("      - run: npm run test:coverage\n");
  });

  it("run every night and on the Run workflow button, with coverage", async () => {
    const nightly = await read(".github/workflows/nightly.yml");

    expect(nightly).toMatch(
      /on:\n {2}schedule:\n(?: {4}#.*\n)? {4}- cron: "[^"]+"\n {2}workflow_dispatch:\n/,
    );
    expect(nightly).toContain("      - run: npm run test:all\n");
    expect(nightly).toMatch(/permissions:\n {2}contents: read\n\n/);
  });
});

describe("browser engines", () => {
  it("runs the browser suite on Firefox and WebKit in CI, each told which engine to use (CC-184)", async () => {
    const ci = await read(".github/workflows/ci.yml");

    expect(ci).toContain("          - browser: firefox\n            os: ubuntu-latest\n");
    // Safari's own engine, on macOS (CC-184).
    expect(ci).toMatch(/ {10}- browser: webkit\n {12}os: macos-latest\n/);
    expect(ci).toContain("          E2E_BROWSER: ${{ matrix.browser }}\n");
    expect(ci).toContain("npx playwright install --with-deps ${{ matrix.browser }}");
  });

  it("keeps the Chromium job's name, which main requires before a merge", async () => {
    expect(await read(".github/workflows/ci.yml")).toContain(
      "name: Browser persona tests (desktop + mobile)\n",
    );
  });
});
