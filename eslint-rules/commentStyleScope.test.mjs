import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMENT_STYLE_ON, COMMENT_STYLE_SWEEP, globsFor } from "./commentStyleScope.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("globsFor", () => {
  it("turns a folder into a glob for every extension", () => {
    expect(globsFor(["packages/games"], ["js", "mjs"])).toEqual(["packages/games/**/*.{js,mjs}"]);
  });

  it("uses a plain glob for a single extension", () => {
    expect(globsFor(["apps/web"], ["css"])).toEqual(["apps/web/**/*.css"]);
  });

  it("keeps a file only when it has one of the extensions", () => {
    expect(globsFor(["apps/server/src/server.js", "a/b.css"], ["js"])).toEqual(["apps/server/src/server.js"]);
  });
});

describe("comment style scope", () => {
  it("numbers the sweep pull requests in order and never lists a path twice", () => {
    expect(COMMENT_STYLE_SWEEP.map(({ pr }) => pr)).toEqual([2, 3, 4, 5, 6]);
    const paths = [...COMMENT_STYLE_ON, ...COMMENT_STYLE_SWEEP.flatMap((step) => step.paths)];
    expect(new Set(paths).size).toBe(paths.length);
  });

  // The real eslint.config.js is read in a separate process. Loading it here would load the rule a second time,
  // outside the test runner, and the coverage report would then count the rule as untested.
  it("switches the rule on in clean folders and off in the folders still to be reworded", () => {
    const files = {
      "packages/games/src/engine.js": 2,
      "packages/shared/src/events.js": 2,
      "eslint-rules/commentStyle.mjs": 2,
      "scripts/commentOnly.mjs": 2,
      "apps/server/src/domain/rooms/roomComponent.js": 0,
      "apps/server/src/server.js": 0,
      "apps/web/src/components/Toast/Toast.jsx": 0,
      "e2e/fixtures.js": 0,
    };
    const program = `
      const { ESLint } = await import("eslint");
      const eslint = new ESLint();
      const result = {};
      for (const file of ${JSON.stringify(Object.keys(files))}) {
        const config = await eslint.calculateConfigForFile(file);
        result[file] = config.rules["classicade/comment-style"]?.[0];
      }
      console.log(JSON.stringify(result));`;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", program], { cwd: root });
    expect(JSON.parse(output)).toEqual(files);
  });
});
