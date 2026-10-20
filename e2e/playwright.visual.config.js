import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./personas.js";
import { CHROMIUM_ACCEPTS_TEST_CERTIFICATE } from "./tlsFront.js";

// Screenshot baselines of the main screens (CC-155). Pixels depend on the fonts, the browser build and the CPU, so
// these run only inside one pinned container image, VISUAL_IMAGE in scripts/visual/docker.mjs: in CI (the visual job in ci.yml),
// in the update workflow and through `npm run test:visual` on a laptop. Each baseline is a reviewed PNG in
// e2e/visual-baselines, named after the screen, the theme and the screen size. The four-part browser suites do
// not run these (playwright.config.js matches *.spec.js only).

export default defineConfig({
  testDir: ".",
  testMatch: "*.visual.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // A test may open up to ten rooms to get the host moving first, and takes four full-page screenshots per screen.
  // On a Mac the x86 container is emulated and runs several times slower than on CI.
  timeout: 60_000,
  outputDir: "visual-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "visual-report" }]],
  snapshotPathTemplate: "{testDir}/visual-baselines/{arg}-{projectName}{ext}",
  expect: {
    toHaveScreenshot: {
      // Playwright's own ways to stop animations, hide the caret and mask parts of the page add a <style>
      // element, which the app's security policy (style-src 'self') blocks, and the players fixture fails the
      // test on that. So reduced motion stops the animations, the spec moves focus away, and its masks are boxes
      // drawn from script, which the policy allows (baselines.visual.js).
      animations: "allow",
      caret: "initial",
      scale: "css",
      // A few pixels of antialiasing noise, never a share of the page, which could hide a moved button.
      maxDiffPixels: 8,
    },
  },
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    // Both projects are Chromium. It accepts the certificate during the handshake instead of restarting each
    // request after the error (CC-319).
    launchOptions: { args: [...CHROMIUM_ACCEPTS_TEST_CERTIFICATE] },
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    // The resting look of each screen. The motion itself is checked by visual.spec.js.
    reducedMotion: "reduce",
    locale: "en-GB",
    timezoneId: "UTC",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "npm run build:web --prefix .. && node server.mjs",
    url: `${BASE_URL}/health`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
