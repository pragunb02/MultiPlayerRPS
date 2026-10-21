import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(import.meta.dirname, "..");

/** Every `.name` a stylesheet defines, in any selector. */
const classesIn = (css) =>
  new Set(
    [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(([, name]) => name),
  );

/**
 * The class names a component reads by name from each CSS module it imports, as `styles.name` or `styles["name"]`.
 * A name worked out at run time (`styles[variant]`) is left to the component's own tests.
 */
function usesIn(file) {
  const source = readFileSync(file, "utf8");
  const uses = [];
  for (const [, binding, from] of source.matchAll(/^import (\w+) from "(\.[^"]+\.module\.css)";$/gm)) {
    const css = path.join(path.dirname(file), from);
    const pattern = new RegExp(`\\b${binding}(?:\\.([A-Za-z_]\\w*)(?![\\w.]*\\.css)|\\["([\\w-]+)"\\])`, "g");
    for (const [, dotted, quoted] of source.matchAll(pattern)) uses.push({ css, name: dotted ?? quoted });
  }
  return uses;
}

describe("CSS module class names (CC-323)", () => {
  it("every class a component names exists in its CSS module, so no declaration silently does nothing (AC-14)", () => {
    const missing = [];
    for (const file of globSync("**/*.jsx", { cwd: SRC }).map((name) => path.join(SRC, name))) {
      for (const { css, name } of usesIn(file)) {
        if (!classesIn(readFileSync(css, "utf8")).has(name)) {
          missing.push(`${path.relative(SRC, file)}: ${name} is not in ${path.basename(css)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("reads classes from every kind of selector", () => {
    expect(classesIn(".a, .b:hover > .c-d::after /* .gone */ { }")).toEqual(new Set(["a", "b", "c-d"]));
  });
});
