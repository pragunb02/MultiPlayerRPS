import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Two projects: Node for server and packages, jsdom for the web app. Coverage floors from docs/ENGINEERING.md §4.
export default defineConfig({
  test: {
    // Tests tagged slow play many whole games (bot strength, long legality walks). Pull requests leave them out
    // with `--tags-filter="not slow"` (npm test, npm run test:coverage) and the nightly workflow runs them
    // (npm run test:all, .github/workflows/nightly.yml). Fast checks of the same code stay untagged (CC-203).
    tags: [
      {
        name: "slow",
        description: "Long bot games and walks, run nightly and by npm run test:all (CC-203).",
        timeout: 300_000,
      },
    ],
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: [
            "apps/server/**/*.test.js",
            "packages/**/*.test.js",
            "eslint-rules/**/*.test.mjs",
            "scripts/**/*.test.mjs",
            "e2e/**/*.test.js",
          ],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["apps/web/**/*.test.{js,jsx}"],
          setupFiles: ["apps/web/src/testing/setup.js"],
          css: { modules: { classNameStrategy: "non-scoped" } },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: [
        "apps/*/src/**/*.{js,jsx}",
        "packages/*/src/**/*.js",
        "eslint-rules/**/*.mjs",
        "scripts/**/*.mjs",
        // The browser suite's own logic. The rest of e2e/ is browser tests, run by Playwright.
        "e2e/browserNoise.js",
        "e2e/tlsFront.js",
      ],
      // Entry points only wire things together (covered indirectly): server index.js, web main.jsx, scripts/bin and
      // the two comment scripts, whose logic is tested in eslint-rules/cssComments.mjs and scripts/commentOnly.mjs.
      exclude: [
        "**/*.test.{js,jsx,mjs}",
        "**/testing/**",
        "apps/server/src/index.js",
        "apps/web/src/main.jsx",
        "scripts/bin/**",
        "scripts/check-comments.mjs",
        "scripts/comment-only-diff.mjs",
      ],
      reporter: ["text", "html"],
      // Every line and function is tested (CC-084). Branches: the few left are listed with reasons in
      // docs/tickets/CC-084.md (concurrent-write races, old MongoDB fallbacks); the merged report also under-counts
      // shared files loaded by both projects.
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 99.9,
        branches: 99,
      },
    },
  },
});
