import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./personas.js";
import { RESTARTS, specFilesFor } from "./shards.js";
import { CHROMIUM_ACCEPTS_TEST_CERTIFICATE } from "./tlsFront.js";

// Browser tests of whole journeys, one file per kind of person (ENGINEERING.md §4). Run: npm run test:e2e
// CI runs the suite in parts on separate machines, one part each (E2E_SHARD, shards.js, CC-236). Without
// E2E_SHARD every file runs.

// One browser engine per run, so each engine is its own CI job (CC-184). Chromium is the default and runs on a
// laptop and a phone. Firefox and WebKit run on a laptop: E2E_BROWSER=firefox npm run test:e2e
const ENGINES = Object.freeze({
  chromium: [
    { name: "desktop", device: devices["Desktop Chrome"] },
    { name: "mobile", device: devices["Pixel 7"] },
  ],
  firefox: [{ name: "firefox", device: devices["Desktop Firefox"] }],
  webkit: [
    {
      name: "webkit",
      device: devices["Desktop Safari"],
      // GitHub's macOS runners are too slow to time a 100 ms answer: presses were answered in 101 to 508 ms there
      // and each of these tests took 3 to 6 minutes. The level-up burst comes and goes faster than the runner
      // looks for it, so that check missed it in two runs out of four. These pass on WebKit on a laptop, and
      // Chromium and Firefox run them on each pull request (CC-184).
      grepInvert: process.env.CI
        ? /every press in .* answers within 100 ms|a level-up bursts behind the new badge/
        : undefined,
      // Chess games that take 4 s on a laptop took over 30 s on those runners, so WebKit gets 60 s there. The
      // other engines keep Playwright's 30 s.
      timeout: process.env.CI ? 60_000 : undefined,
    },
  ],
});
const engine = process.env.E2E_BROWSER ?? "chromium";
if (!Object.hasOwn(ENGINES, engine)) {
  throw new Error(`E2E_BROWSER must be one of ${Object.keys(ENGINES).join(", ")}, not "${engine}"`);
}
const targets = ENGINES[engine];

/**
 * Restarting the server cuts every player off, so the restart tests run last and one at a time, after all the
 * others, one device after another.
 */
const restartProjects = targets.map(({ name, device }, index) => ({
  name: `restart ${name}`,
  use: { ...device },
  testMatch: RESTARTS,
  fullyParallel: false,
  // One test at a time across every file: a restart cuts off whatever else is running (CC-207).
  workers: 1,
  dependencies: index === 0 ? targets.map((target) => target.name) : [`restart ${targets[index - 1].name}`],
}));

export default defineConfig({
  testDir: ".",
  testMatch: specFilesFor(process.env.E2E_SHARD),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    // The e2e server's certificate is made for each run (tlsFront.js), so no browser trusts it by itself.
    ignoreHTTPSErrors: true,
    // Chromium accepts it during the handshake instead of restarting each request after the error (CC-319).
    ...(engine === "chromium" ? { launchOptions: { args: [...CHROMIUM_ACCEPTS_TEST_CERTIFICATE] } } : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    ...targets.map(({ name, device, grepInvert, timeout }) => ({
      name,
      use: { ...device },
      testIgnore: RESTARTS,
      grepInvert,
      timeout,
    })),
    ...restartProjects,
  ],
  webServer: {
    command: "npm run build:web --prefix .. && node server.mjs",
    url: `${BASE_URL}/health`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
