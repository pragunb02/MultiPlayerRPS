import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./personas.js";

// Browser tests of whole journeys, one file per kind of person (ENGINEERING.md §4). Run: npm run test:e2e
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
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run build:web --prefix .. && node server.mjs",
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
