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
        // JSX lives only in .jsx files. By default the React plugin also has every .js file outside node_modules
        // rewritten by oxc, whose source map is coarser than the node project's, so a file both projects load
        // (packages/shared, packages/games) got two copies of each arrow function in the merged report, and the
        // web copy, never called there, counted as uncovered (CC-309).
        plugins: [react({ include: /\.jsx$/ })],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["apps/web/**/*.test.{js,jsx}"],
          // slowEffects.js first: it must load before React (CC-288).
          setupFiles: ["apps/web/src/testing/slowEffects.js", "apps/web/src/testing/setup.js"],
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
        "e2e/shards.js",
        "e2e/reportSummary.js",
        "e2e/testAudio.js",
      ],
      // Entry points only wire things together (covered indirectly): server index.js, web main.jsx, scripts/bin and
      // the two comment scripts, whose logic is tested in eslint-rules/cssComments.mjs and scripts/commentOnly.mjs, and
      // the CSS token check, whose logic is tested in scripts/design/cssTokens.mjs (CC-314).
      exclude: [
        "**/*.test.{js,jsx,mjs}",
        "**/testing/**",
        "apps/server/src/index.js",
        // A worker thread's entry point: it runs outside the test runner's coverage, and its one call is the pure
        // createBotThinker, covered directly. botThinkingClient.test.js runs it for real (CC-308).
        "apps/server/src/dependency/thinking/botThinkingWorker.js",
        "apps/web/src/main.jsx",
        "scripts/bin/**",
        "scripts/check-comments.mjs",
        "scripts/check-css-tokens.mjs",
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
