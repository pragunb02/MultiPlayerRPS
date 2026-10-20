import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FLAGS, isFlagName } from "@classicade/shared";
import { flagNamesIn, flagPathsIn } from "./testing/flagSources.js";

// Feature flag hygiene across the whole repository (CC-312, ADR-073). Code names a flag by a string, so these
// tests read the source: a name that is not registered fails here, and so does a registered flag that no code
// reads or that has no suite running it both on and off.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FOLDERS = ["apps/server/src", "apps/web/src", "packages", "e2e"];
const SKIP = new Set(["node_modules", "dist", "coverage", "visual-baselines", "test-results"]);

/** Every JavaScript file under a folder, as [path, text]. */
function filesUnder(folder) {
  return readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const relative = path.join(folder, entry.name);
    if (entry.isDirectory()) return filesUnder(relative);
    return /\.(m?js|jsx)$/.test(entry.name)
      ? [[relative, readFileSync(path.join(root, relative), "utf8")]]
      : [];
  });
}

const files = FOLDERS.flatMap(filesUnder);
const isTest = (file) =>
  /\.test\.(m?js|jsx)$|\.spec\.js$/.test(file) || file.includes(`${path.sep}testing${path.sep}`);
const sources = files.filter(([file]) => !isTest(file));
const tests = files.filter(([file]) => isTest(file));

describe("feature flag names in the source (CC-312)", () => {
  it("finds the flag names code reads and the flags a suite runs on and off", () => {
    const text = `await flags.isOn("a_flag", player); useFlag('b_flag'); recordSuccess("c_flag", player);`;

    expect(flagNamesIn(text)).toEqual(["a_flag", "b_flag", "c_flag"]);
    expect(flagPathsIn(`flagPaths("a_flag", (on) => {});`)).toEqual(["a_flag"]);
  });

  it("every flag name in the source is registered", () => {
    const unknown = sources.flatMap(([file, text]) =>
      flagNamesIn(text)
        .filter((name) => !isFlagName(name))
        .map((name) => `${file}: ${name}`),
    );

    expect(unknown).toEqual([]);
  });

  it("every flag is read by some code, or it should be removed", () => {
    const read = new Set(sources.flatMap(([, text]) => flagNamesIn(text)));

    expect(FLAGS.map(({ name }) => name).filter((name) => !read.has(name))).toEqual([]);
  });

  it("every flag has a flagPaths suite that runs it on and off", () => {
    const covered = new Set(tests.flatMap(([, text]) => flagPathsIn(text)));

    expect(FLAGS.map(({ name }) => name).filter((name) => !covered.has(name))).toEqual([]);
  });
});
