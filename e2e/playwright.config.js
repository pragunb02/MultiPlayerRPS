import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./personas.js";

// Browser tests of whole journeys, one file per kind of person (ENGINEERING.md §4). Run: npm run test:e2e
// The tests that restart the server (CC-101).
const RESTARTS = "restart.spec.js";

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
      // and each of these tests took 3 to 6 minutes. They pass on WebKit on a laptop, and Chromium and Firefox
      // time every press on each pull request (CC-184).
      grepInvert: process.env.CI ? /every press in .* answers within 100 ms/ : undefined,
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
  dependencies: index === 0 ? targets.map((target) => target.name) : [`restart ${targets[index - 1].name}`],
}));

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    // The e2e server's certificate is made for each run (tlsFront.js), so no browser trusts it by itself.
    ignoreHTTPSErrors: true,
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
