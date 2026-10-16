import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Two projects: Node for server and packages, jsdom for the web app. Coverage floors from docs/ENGINEERING.md §4.
export default defineConfig({
  test: {
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
