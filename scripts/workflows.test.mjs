import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { BACKUP_SECRETS } from "./backup/backupConfig.mjs";
import { DOWN_STEP_NAME } from "./uptime/incident.mjs";
import { GAMES } from "../e2e/matchStates.js";
import { RESTARTS, SHARDS } from "../e2e/shards.js";

// The workflow files and the scripts depend on each other by name. These checks keep the two in step, and pin the
// rules that keep data out of this public repository's logs and artifacts.
const read = (/** @type {string} */ path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** One job of a workflow, from its id to the next job. */
const job = (/** @type {string} */ workflow, /** @type {string} */ id) => {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  if (start < 0) throw new Error(`no job ${id}`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next + 1);
};

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
  it("runs the browser suite on Firefox on every pull request (CC-184)", async () => {
    const ci = await read(".github/workflows/ci.yml");

    expect(job(ci, "e2e-firefox-parts")).toContain("          browser: firefox\n");
    expect(job(ci, "e2e-firefox-parts")).toContain("          E2E_BROWSER: firefox\n");
    expect(job(ci, "e2e-firefox-restarts")).toContain("          E2E_BROWSER: firefox\n");
  });

  it("runs WebKit on macOS, Safari's own engine, every night, on demand and when the browser's code changes", async () => {
    const webkit = await read(".github/workflows/webkit.yml");

    expect(webkit).toContain("    runs-on: macos-latest\n");
    expect(webkit).toMatch(/on:\n {2}pull_request:\n {4}paths:\n {6}- "apps\/web\/\*\*"\n/);
    expect(webkit).toContain('      - "e2e/**"\n');
    expect(webkit).toMatch(/ {2}schedule:\n(?: {4}#.*\n)? {4}- cron: "[^"]+"\n {2}workflow_dispatch:\n/);
    expect(webkit).toMatch(/permissions:\n {2}contents: read\n\n/);
  });

  it("splits WebKit in three and still runs every test, the restart tests once", async () => {
    const webkit = await read(".github/workflows/webkit.yml");

    expect(webkit).toContain("        shard: [1, 2, 3]\n");
    expect(webkit).toContain("--project=webkit --shard=${{ matrix.shard }}/3");
    expect(webkit).toContain("        if: matrix.shard == 1 && !cancelled()\n");
    expect(webkit).toContain('--project="restart webkit" --no-deps');
    expect(webkit.match(/E2E_BROWSER: webkit\n/g)).toHaveLength(2);
  });

  it("cancels an older run of a pull request, but never a run on main, where each commit has its own group", async () => {
    expect(await read(".github/workflows/ci.yml")).toContain(
      "concurrency:\n  group: ci-${{ github.event_name == 'pull_request' && github.ref || github.sha }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n",
    );
  });

  it("keeps the names of the Chromium and Firefox checks, which branch protection can require", async () => {
    const ci = await read(".github/workflows/ci.yml");

    expect(job(ci, "e2e")).toContain("    name: Browser persona tests (desktop + mobile)\n");
    expect(job(ci, "e2e-firefox")).toContain("    name: Browser persona tests (firefox desktop)\n");
  });
});

// CI runs the Chromium and Firefox suites in parts (CC-236, e2e/shards.js). These checks make sure the parts
// together are the whole suite: every spec file in exactly one part, every part on CI for both engines, the
// restart tests on their own, and a last job that passes only when all of them passed.
describe("browser test parts", () => {
  const ENGINES = [
    {
      parts: "e2e-parts",
      restarts: "e2e-restarts",
      merge: "e2e",
      projects: "--project=desktop --project=mobile",
      blob: "chromium",
    },
    {
      parts: "e2e-firefox-parts",
      restarts: "e2e-firefox-restarts",
      merge: "e2e-firefox",
      projects: "--project=firefox",
      blob: "firefox",
    },
  ];
  const specFiles = async () =>
    (await readdir(new URL("../e2e/", import.meta.url))).filter((name) => name.endsWith(".spec.js")).sort();

  it("put every spec file but the restart tests in exactly one part", async () => {
    const planned = SHARDS.flat();

    expect((await specFiles()).filter((name) => RESTARTS.test(name))).toContain("restart.spec.js");
    expect([...planned].sort()).toEqual((await specFiles()).filter((name) => !RESTARTS.test(name)));
    expect(new Set(planned).size).toBe(planned.length);
  });

  it("give every game's press tests a file of its own, so they can run on separate machines", async () => {
    const files = await specFiles();

    for (const gameId of Object.keys(GAMES)) {
      const file = `match-shell-presses-${gameId}.spec.js`;
      expect(files).toContain(file);
      expect(await read(`e2e/${file}`)).toContain(`pressEveryStateOf("${gameId}");`);
    }
  });

  it("all run on CI, for both engines, each part on its own machine", async () => {
    const ci = await read(".github/workflows/ci.yml");
    const numbers = SHARDS.map((_, index) => index + 1);

    for (const engine of ENGINES) {
      const parts = job(ci, engine.parts);
      expect(parts).toContain(`        part: [${numbers.join(", ")}]\n`);
      expect(parts).toContain(`part \${{ matrix.part }} of ${SHARDS.length})\n`);
      expect(parts).toContain("          E2E_SHARD: ${{ matrix.part }}\n");
      expect(parts).toContain(`        run: npx playwright test ${engine.projects} --workers=`);
      expect(parts).toContain("      fail-fast: false\n");
      expect(parts).toContain(`          name: blob-${engine.blob}-part-\${{ matrix.part }}\n`);
    }
  });

  it("run the restart tests in a job of their own, one at a time", async () => {
    const ci = await read(".github/workflows/ci.yml");

    expect(job(ci, "e2e-restarts")).toContain(
      '--project="restart desktop" --project="restart mobile" --no-deps --workers=1 ',
    );
    expect(job(ci, "e2e-firefox-restarts")).toContain('--project="restart firefox" --no-deps --workers=1 ');
  });

  it("pass only when every part and the restart tests passed and every listed test ran exactly once", async () => {
    const ci = await read(".github/workflows/ci.yml");

    for (const engine of ENGINES) {
      const merge = job(ci, engine.merge);
      expect(merge).toContain(`    needs: [${engine.parts}, ${engine.restarts}]\n`);
      expect(merge).toContain(`          pattern: blob-${engine.blob}-*\n`);
      expect(merge).toContain("npx playwright test --list --reporter=json > listed.json\n");
      expect(merge).toContain(" listed.json merged.json\n");
      expect(merge).toContain('test "$PARTS" = success && test "$RESTARTS" = success');
      expect(merge).toContain(`          PARTS: \${{ needs.${engine.parts}.result }}\n`);
      expect(merge).toContain(`          RESTARTS: \${{ needs.${engine.restarts}.result }}\n`);
    }
  });
});

describe("visual baselines (CC-155)", () => {
  it("compare on every pull request in an advisory job that keeps the differences, videos and traces", async () => {
    const visual = job(await read(".github/workflows/ci.yml"), "visual");

    expect(visual).toContain("    name: Visual baselines (advisory)\n");
    // Advisory on main too: a push to main never runs it, so a visual diff can never turn main red.
    expect(visual).toContain("    if: github.event_name == 'pull_request'\n");
    expect(visual).toContain("        run: npx playwright test -c playwright.visual.config.js --workers=2\n");
    expect(visual).toContain("        if: failure()\n        uses: actions/upload-artifact@v7");
    expect(visual).toContain("          path: e2e/visual-results/\n          retention-days: 14\n");
  });

  it("record a video and a trace of a failing test", async () => {
    const { default: config } = await import("../e2e/playwright.visual.config.js");

    expect(config.use).toMatchObject({ video: "retain-on-failure", trace: "retain-on-failure" });
    expect(config.retries).toBe(0);
  });

  it("are updated only on a ticket branch, and the branch's code never runs with a token that can push", async () => {
    const workflow = await read(".github/workflows/visual-update.yml");
    const render = job(workflow, "render");
    const commit = job(workflow, "commit");

    expect(workflow).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(render).not.toContain("permissions:");
    expect(render).toContain("persist-credentials: false");
    // The whole value is matched, not one line of it, so a ticket with a second line cannot reach the commit
    // message. Both jobs check, and each check runs in bash, where `=~` is defined.
    for (const each of [render, commit]) {
      expect(each).toContain('[[ "$TICKET" =~ ^CC-[0-9]{3}$ ]]');
      expect(each).toContain("        shell: bash\n");
      expect(each).toContain("          TICKET: ${{ inputs.ticket }}\n");
    }
    expect(render).toContain('[[ "$GITHUB_REF" =~ ^refs/heads/cc-[0-9]{3}-[a-z0-9-]+$ ]]');
    expect(workflow).not.toContain("grep -Eq");
    // Run on the branch itself: checking out another ref would run its code with main's caches (CodeQL).
    expect(workflow).not.toMatch(/inputs\.branch|ref: \$\{\{/);
    expect(render).toContain("--update-snapshots=changed");
    expect(commit).toContain("    permissions:\n      contents: write\n");
    expect(commit).not.toMatch(/npm|npx|node /);
    expect(commit).toContain('git commit --quiet --message "$TICKET: ');
    // Inputs reach shell scripts only through the environment, never pasted into the script.
    expect(workflow).not.toMatch(/run: .*\$\{\{ inputs\./);
  });
});
