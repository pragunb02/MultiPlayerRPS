// How to run the screenshot baselines (e2e/baselines.visual.js) in the same pinned container image as CI (CC-155). The
// pixels of a page depend on the fonts, the browser build and the processor, so a baseline made on a Mac would not
// match CI's. `npm run test:visual` compares, `npm run test:visual:update` writes new baselines for review.
//
// The repository is copied into the container without its node_modules, because the packages on a Mac are built
// for macOS. The container installs its own, runs the tests, and copies back the report and the results (actual,
// expected and diff images, traces and videos of failures) and, when updating, the baselines.

/**
 * The image every visual run uses: CI's visual job, the update workflow and this script. Its version must be the
 * installed Playwright's, which scripts/visual.test.mjs checks.
 */
export const VISUAL_IMAGE = "mcr.microsoft.com/playwright:v1.64.1-noble";

/** CI's runners are x86. The same image on an Apple Silicon Mac draws some edges differently, so it is emulated. */
export const VISUAL_PLATFORM = "linux/amd64";

/** Docker volumes that keep the npm download cache and the MongoDB binary between runs. */
const CACHES = Object.freeze([
  "classicade-visual-npm:/root/.npm",
  "classicade-visual-mongodb:/root/.cache/mongodb-binaries",
]);

/**
 * The shell script the container runs. Exits with the tests' exit code, after copying the results back.
 *
 * @param {{ update: boolean }} options update writes new baselines instead of comparing
 * @returns {string}
 */
export function containerScript({ update }) {
  const testArgs = update ? "--update-snapshots=changed" : "";
  // Only an update touches the checkout's baselines. A comparison leaves them exactly as they are.
  const copiedBack = ["/repo/e2e/visual-results", "/repo/e2e/visual-report"];
  if (update) copiedBack.push("/repo/e2e/visual-baselines");
  return [
    "set -u",
    "mkdir -p /work",
    "tar -C /repo --exclude=./.git --exclude='*/node_modules' --exclude=./node_modules -cf - . | tar -C /work -xf -",
    "cd /work",
    "npm ci --no-audit --no-fund --loglevel=error || exit 1",
    "cd e2e",
    `npx playwright test -c playwright.visual.config.js ${testArgs}`.trim(),
    "status=$?",
    "rm -rf /repo/e2e/visual-results /repo/e2e/visual-report",
    "cp -R visual-results visual-report /repo/e2e/ 2>/dev/null",
    ...(update ? ["rm -rf /repo/e2e/visual-baselines", "cp -R visual-baselines /repo/e2e/"] : []),
    // Files written by the container belong to root on Linux. They are given back to the person running this.
    `chown -R "$HOST_UID:$HOST_GID" ${copiedBack.join(" ")} 2>/dev/null`,
    'exit "$status"',
  ].join("\n");
}

/**
 * The `docker run` arguments for one visual run.
 *
 * @param {{ repo: string, update: boolean, uid: number, gid: number }} options the repository's absolute path,
 *   whether to write new baselines, and the user and group to give the copied files to
 * @returns {string[]}
 */
export function dockerArgs({ repo, update, uid, gid }) {
  return [
    "run",
    "--rm",
    // Chromium needs more shared memory than Docker gives by default, and --init reaps its child processes
    // (playwright.dev/docs/docker).
    "--init",
    "--ipc=host",
    "--platform",
    VISUAL_PLATFORM,
    "--volume",
    `${repo}:/repo`,
    ...CACHES.flatMap((cache) => ["--volume", cache]),
    "--env",
    `HOST_UID=${uid}`,
    "--env",
    `HOST_GID=${gid}`,
    VISUAL_IMAGE,
    "bash",
    "-c",
    containerScript({ update }),
  ];
}

/**
 * Reads the command line: no arguments compares, `--update` writes new baselines.
 *
 * @param {readonly string[]} argv the arguments after the script's name
 * @returns {{ update: boolean }}
 */
export function parseArgs(argv) {
  const unknown = argv.filter((arg) => arg !== "--update");
  if (unknown.length > 0) {
    throw new Error(`unknown argument ${unknown[0]}. Use no arguments to compare, or --update`);
  }
  return { update: argv.includes("--update") };
}
