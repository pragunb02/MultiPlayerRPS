import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./personas.js";

// Browser tests of whole journeys, one file per kind of person (ENGINEERING.md §4). Run: npm run test:e2e
// The tests that restart the server (CC-101).
const RESTARTS = "restart.spec.js";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The app plays sounds (CC-103). Test browsers keep them to themselves instead of playing them on the
    // machine running the tests.
    launchOptions: { args: ["--mute-audio"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: RESTARTS },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testIgnore: RESTARTS },
    // Restarting the server cuts every player off, so these run last and one at a time, after all the others.
    {
      name: "restart desktop",
      use: { ...devices["Desktop Chrome"] },
      testMatch: RESTARTS,
      fullyParallel: false,
      dependencies: ["desktop", "mobile"],
    },
    {
      name: "restart mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: RESTARTS,
      fullyParallel: false,
      dependencies: ["restart desktop"],
    },
  ],
  webServer: {
    command: "npm run build:web --prefix .. && node server.mjs",
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
