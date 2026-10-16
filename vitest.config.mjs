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
          include: ["apps/server/**/*.test.js", "packages/**/*.test.js"],
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
      include: ["apps/*/src/**/*.{js,jsx}", "packages/*/src/**/*.js"],
      // Entry points only wire things together (covered indirectly): server index.js, web main.jsx.
      exclude: ["**/*.test.{js,jsx}", "**/testing/**", "apps/server/src/index.js", "apps/web/src/main.jsx"],
      reporter: ["text", "html"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        "packages/games/**": { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
