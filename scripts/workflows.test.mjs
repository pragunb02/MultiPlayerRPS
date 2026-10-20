import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { BACKUP_SECRETS } from "./backup/backupConfig.mjs";
import { VISUAL_IMAGE } from "./visual/docker.mjs";
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
    expect(visual).toContain(
      "        if: steps.compare.outcome == 'failure'\n        uses: actions/upload-artifact@v7",
    );
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

// After a merge, main's baselines are made again and proposed in one bot pull request (CC-300). A pull request's
// visual check fails only when the pull request itself changes a file the screens are drawn from.
describe("visual baselines refresh after merge (CC-300)", () => {
  /** What the screens are drawn from. Both workflows must use exactly this list. */
  const SCREEN_INPUTS = ["apps/**", "packages/**", "e2e/**", "package.json", "package-lock.json"];
  const refreshWorkflow = () => read(".github/workflows/visual-refresh.yml");
  const parsed = async (/** @type {string} */ path) => parse(await read(path));
  /** The shell script of one step, as GitHub runs it. */
  const script = async (
    /** @type {string} */ path,
    /** @type {string} */ jobId,
    /** @type {string} */ name,
  ) =>
    (await parsed(path)).jobs[jobId].steps.find((/** @type {{ name?: string }} */ step) => step.name === name)
      .run;

  it("runs on a push to main that changes the screens' files, or by hand, and on nothing a pull request starts", async () => {
    const { on } = await parsed(".github/workflows/visual-refresh.yml");

    expect(Object.keys(on).sort()).toEqual(["push", "workflow_dispatch"]);
    expect(on.push).toEqual({
      branches: ["main"],
      paths: [...SCREEN_INPUTS, ".github/workflows/visual-refresh.yml"],
    });
    expect(await refreshWorkflow()).not.toMatch(/pull_request_target|workflow_run|pull_request:/);
  });

  it("runs one refresh at a time and never cancels one halfway", async () => {
    const { concurrency } = await parsed(".github/workflows/visual-refresh.yml");

    expect(concurrency).toEqual({ group: "visual-refresh", "cancel-in-progress": false });
  });

  it("renders with a read-only token on main's own commit, and only the job that runs no project code can write", async () => {
    const workflow = await parsed(".github/workflows/visual-refresh.yml");
    const { render, propose } = workflow.jobs;

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(workflow.jobs).sort()).toEqual(["propose", "render"]);
    for (const each of [render, propose]) expect(each.if).toBe("github.ref == 'refs/heads/main'");
    expect(render.permissions).toBeUndefined();
    expect(render.container.image).toBe(VISUAL_IMAGE);
    expect(render.steps[0]).toEqual({ uses: "actions/checkout@v7", with: { "persist-credentials": false } });
    expect(
      render.steps.find((/** @type {{ name?: string }} */ step) => step.name === "Make the baselines").run,
    ).toBe("npx playwright test -c playwright.visual.config.js --workers=2 --update-snapshots=changed");
    expect(propose.needs).toBe("render");
    expect(propose.permissions).toEqual({ contents: "write", "pull-requests": "write" });
    // No other ref is ever checked out, so no unreviewed code runs here or with main's caches (CodeQL, #104).
    expect(await refreshWorkflow()).not.toMatch(/\n\s+ref:/);
    const proposeText = JSON.stringify(propose);
    expect(proposeText).not.toMatch(/npm|npx|node |actions\/cache|setup-node/);
  });

  it("never pushes to main: its one push goes to the refresh branch, and it never merges", async () => {
    const workflow = await refreshWorkflow();
    const { propose } = (await parsed(".github/workflows/visual-refresh.yml")).jobs;
    const step = propose.steps.find((/** @type {{ run?: string }} */ each) => each.run?.includes("git push"));

    expect(workflow.match(/git push[^\n]*/g)).toEqual(['git push --force origin "HEAD:refs/heads/$BRANCH"']);
    expect(step.env.BRANCH).toBe("visual-baselines/refresh");
    expect(step.run).toContain('[[ "$BRANCH" == visual-baselines/refresh ]] || {');
    expect(step.run.indexOf('[[ "$BRANCH" == visual-baselines/refresh ]]')).toBeLessThan(
      step.run.indexOf("git push"),
    );
    expect(workflow).not.toMatch(/gh pr merge|--admin|HEAD:main|refs\/heads\/main"|git push origin main/);
    expect(step.run).toContain('--base main --head "$BRANCH"');
  });

  it("commits only changed screen images, never removes one, and lists them in a comment", async () => {
    const run = await script(
      ".github/workflows/visual-refresh.yml",
      "propose",
      "Commit, push the refresh branch, and open or update its pull request",
    );

    expect(run).toContain("grep -Ev '^e2e/visual-baselines/[a-z0-9-]+\\.png$'");
    expect(run).toContain("--diff-filter=D");
    expect(run).toContain('gh pr comment "$open" --repo "$GITHUB_REPOSITORY" --body-file "$comment"');
    // Nothing changed: a refresh still open is out of date, so it is closed, and nothing is pushed.
    expect(run.indexOf("gh pr close")).toBeLessThan(run.indexOf("git push"));
  });

  it("decides whether a pull request changes the screens from the same list as the refresh", async () => {
    const run = await script(".github/workflows/ci.yml", "visual-scope", "Files this pull request changes");
    const pattern = new RegExp(/grep -Eq '([^']+)'/.exec(run)?.[1] ?? "never");
    const changesScreens = (/** @type {string[]} */ files) => files.some((file) => pattern.test(file));

    expect(run).toContain("git diff --name-only HEAD^1 HEAD");
    expect(run).toContain("screens=true\n");
    for (const input of SCREEN_INPUTS) {
      expect(changesScreens([input.replace("**", "some/file.js")])).toBe(true);
    }
    expect(changesScreens(["e2e/visual-baselines/home-guest-dark-desktop.png"])).toBe(true);
    expect(
      changesScreens(["docs/tickets/CC-300.md", "scripts/workflows.test.mjs", ".github/workflows/ci.yml"]),
    ).toBe(false);
    expect(changesScreens(["docs/apps/note.md", "package.json.bak", "scripts/package.json"])).toBe(false);
  });

  it("looks at the pull request with a read-only token and keeps no credentials", async () => {
    const { jobs } = await parsed(".github/workflows/ci.yml");

    expect(jobs["visual-scope"].if).toBe("github.event_name == 'pull_request'");
    expect(jobs["visual-scope"].permissions).toEqual({ contents: "read", "pull-requests": "read" });
    expect(jobs["visual-scope"].steps[0].with).toEqual({ "fetch-depth": 2, "persist-credentials": false });
    expect(jobs.visual.needs).toBe("visual-scope");
    expect(
      jobs.visual.steps.find((/** @type {{ id?: string }} */ step) => step.id === "compare"),
    ).toMatchObject({
      "continue-on-error": true,
    });
  });

  describe("the pull request's verdict", () => {
    /** Runs the verdict step as GitHub would, with the given outcome. */
    const verdict = async (/** @type {Record<string, string>} */ env) => {
      const run = await script(".github/workflows/ci.yml", "visual", "Verdict");
      const directory = await mkdtemp(join(tmpdir(), "cc300-"));
      const summary = join(directory, "summary.md");
      await writeFile(summary, "");
      try {
        const result = spawnSync("bash", ["-e", "-c", run], {
          encoding: "utf8",
          env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: summary, REFRESH: "", ...env },
        });
        return { status: result.status, output: result.stdout, summary: await readFile(summary, "utf8") };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    };

    it("passes when every screen matches", async () => {
      expect((await verdict({ COMPARE: "success", SCREENS: "true" })).status).toBe(0);
    });

    it("passes with a notice when the pull request changes no screen file, naming the open refresh", async () => {
      const result = await verdict({
        COMPARE: "failure",
        SCREENS: "false",
        REFRESH: "https://github.com/pragunb02/MultiPlayerRPS/pull/1",
      });

      expect(result.status).toBe(0);
      expect(result.output).toContain(
        "::notice title=Visual baselines::baselines on main are stale; a refresh PR is pending: https://github.com/pragunb02/MultiPlayerRPS/pull/1",
      );
      expect(result.summary).toContain("Baselines on main are stale; a refresh PR is pending");
    });

    it("fails when the pull request changes a screen file, and points at the open refresh", async () => {
      const result = await verdict({
        COMPARE: "failure",
        SCREENS: "true",
        REFRESH: "https://example.test/pull/2",
      });

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        "::error title=Visual baselines::a screen differs from main's baselines.",
      );
      expect(result.summary).toContain("its refresh pull request is open: https://example.test/pull/2");
    });

    it("fails when it cannot tell, or when the comparison did not run", async () => {
      expect((await verdict({ COMPARE: "failure", SCREENS: "" })).status).toBe(1);
      expect((await verdict({ COMPARE: "skipped", SCREENS: "false" })).status).toBe(1);
    });
  });
});

describe("render.yaml schema check", () => {
  it("runs on pull requests only, so a slow render.com never holds back a deploy of main", async () => {
    const check = job(await read(".github/workflows/ci.yml"), "render-blueprint");

    expect(check).toContain("    if: github.event_name == 'pull_request'\n");
    expect(check).toContain("      - run: node scripts/bin/check-render-blueprint.mjs\n");
    expect(check).not.toMatch(/secrets\./);
  });
});

// The merge queue (CC-298, ADR-074). A required check must report on the queue's `merge_group` run, or the queue
// waits for it until its timeout. These pin which events start each workflow and which jobs run on each event, and
// keep the check names the owner requires in docs/DEPLOYMENT.md in step with the jobs that report them.
describe("merge queue (CC-298)", () => {
  const EVENTS = ["pull_request", "merge_group", "push"];

  /** The events a job runs on, from its `if`. Any condition not written in these two forms fails the test. */
  const eventsOf = (/** @type {string | undefined} */ condition) => {
    if (condition === undefined || condition === "${{ !cancelled() }}") return EVENTS;
    const parts = condition
      .split(" || ")
      .map((part) => /^github\.event_name == '([a-z_]+)'$/.exec(part)?.[1]);
    if (parts.some((part) => part === undefined))
      throw new Error(`a condition this test cannot read: ${condition}`);
    return parts;
  };

  /** The jobs of ci.yml with their check names and the events each runs on. */
  const ciJobs = async () => {
    const { jobs } = parse(await read(".github/workflows/ci.yml"));
    return Object.entries(jobs).map(([id, each]) => ({ id, name: each.name, events: eventsOf(each.if) }));
  };

  /** The checks the owner requires in the main ruleset, as docs/DEPLOYMENT.md lists them. */
  const REQUIRED = [
    "Lint, format, audit, unit + integration (coverage gates)",
    "Docker image builds and serves (docker compose)",
    "Browser persona tests (desktop + mobile)",
    "Browser persona tests (firefox desktop)",
    "Backup round trip (mongodump, age, mongorestore)",
    "Workflow files (actionlint)",
    "Changelog fragments",
  ];

  it("starts CI on pull requests, the merge queue and pushes to main", async () => {
    const { on } = parse(await read(".github/workflows/ci.yml"));

    expect(on).toEqual({
      pull_request: null,
      merge_group: { types: ["checks_requested"] },
      push: { branches: ["main"] },
    });
  });

  it("runs each job on the events written in ci.yml's table, and no other", async () => {
    const events = Object.fromEntries((await ciJobs()).map(({ id, events: each }) => [id, each]));

    expect(events).toEqual({
      checks: EVENTS,
      "backup-round-trip": EVENTS,
      workflows: EVENTS,
      changes: ["pull_request", "merge_group"],
      "render-blueprint": ["pull_request"],
      "e2e-parts": EVENTS,
      "e2e-restarts": EVENTS,
      e2e: EVENTS,
      "e2e-firefox-parts": EVENTS,
      "e2e-firefox-restarts": EVENTS,
      "e2e-firefox": EVENTS,
      "visual-scope": ["pull_request"],
      visual: ["pull_request"],
      docker: EVENTS,
    });
  });

  it("runs every required check in the merge queue", async () => {
    const jobs = await ciJobs();

    for (const name of REQUIRED) {
      expect(jobs.find((each) => each.name === name)?.events, name).toContain("merge_group");
    }
  });

  it("lists exactly those check names in the owner's steps", async () => {
    const deployment = await read("docs/DEPLOYMENT.md");

    for (const name of REQUIRED) {
      expect(deployment).toContain(`{ "context": "${name}", "integration_id": 15368 }`);
    }
    expect(deployment.match(/"integration_id": 15368/g)).toHaveLength(REQUIRED.length);
  });

  it("gives each queue run a group of its own that no other run cancels", async () => {
    const { concurrency } = parse(await read(".github/workflows/ci.yml"));

    // merge_group is not pull_request, so its group is its own commit and cancel-in-progress is false.
    expect(concurrency.group).toBe(
      "ci-${{ github.event_name == 'pull_request' && github.ref || github.sha }}",
    );
    expect(concurrency["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
  });

  it("starts no other workflow from the merge queue: WebKit is advisory, and the refresh runs after a merge", async () => {
    const folder = new URL("../.github/workflows/", import.meta.url);
    const others = (await readdir(folder)).filter((name) => name !== "ci.yml");

    expect(others).toEqual(expect.arrayContaining(["visual-refresh.yml", "webkit.yml"]));
    for (const name of others) {
      const { on } = parse(await read(`.github/workflows/${name}`));
      expect(Object.keys(on), name).not.toContain("merge_group");
      expect(JSON.stringify(on), name).not.toContain("gh-readonly-queue");
    }
  });
});

describe("changelog fragments check (CC-299)", () => {
  it("runs on pull requests, on the merge commit with main as its first parent, with a read-only token", async () => {
    const workflow = await read(".github/workflows/ci.yml");
    const { jobs, permissions } = parse(workflow);
    const changes = jobs.changes;

    expect(changes.if).toBe("github.event_name == 'pull_request' || github.event_name == 'merge_group'");
    expect(changes.permissions ?? permissions).toEqual({ contents: "read" });
    expect(changes.steps[0].with).toEqual({ "fetch-depth": 2, "persist-credentials": false });
    expect(changes.steps.at(-1).run).toBe("node scripts/bin/collect-changes.mjs --check --base HEAD^1");
    expect(job(workflow, "changes")).not.toMatch(/secrets\.|github\.token/);
  });
});
