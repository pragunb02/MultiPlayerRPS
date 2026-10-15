import { defineConfig } from "vitest/config";

// Coverage floors from docs/ENGINEERING.md §4. Legacy code is not measured.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**/*.js", "packages/*/src/**/*.js"],
      // Process entry point: only reads env and calls startServer (covered by server.test.js).
      exclude: ["**/*.test.js", "**/testing/**", "apps/server/src/index.js"],
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
