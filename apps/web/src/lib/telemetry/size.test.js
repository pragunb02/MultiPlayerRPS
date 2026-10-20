import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../..");
/** The budget of the client's own file, gzipped (CC-174). */
const BUDGET_BYTES = 4 * 1024;

/** Every source file of the web app that is not a test, as [path, text]. */
function sources(folder = src) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === "testing" ? [] : sources(full);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)
      ? [[path.relative(src, full), readFileSync(full, "utf8")]]
      : [];
  });
}

describe("the telemetry client's weight (CC-174)", () => {
  // AC-9 (CC-174)
  it("the client stays under 4 KB gzipped", async () => {
    // The client's own file as the production build makes it: minified, with what the first page already loads
    // (React, the router and the shared catalogue) left out, because those are in the main file.
    const output = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: true,
        lib: { entry: path.join(here, "index.js"), formats: ["es"], fileName: "telemetry" },
        rollupOptions: { external: [/^@classicade\//, /^react/] },
      },
    });
    const [{ output: chunks }] = /** @type {any} */ (Array.isArray(output) ? output : [output]);
    const code = chunks
      .filter((chunk) => chunk.type === "chunk")
      .map((chunk) => chunk.code)
      .join("");
    const gzipped = gzipSync(code).length;

    // eslint-disable-next-line no-console
    console.info(`telemetry client: ${code.length} bytes minified, ${gzipped} bytes gzipped`);
    expect(gzipped).toBeGreaterThan(500);
    expect(gzipped).toBeLessThan(BUDGET_BYTES);
  }, 60_000);

  it("loads after first paint: only the host imports it, and only when it is needed", () => {
    const inFolder = path.join("lib", "telemetry");
    const importers = sources().filter(
      ([file, text]) =>
        /lib\/telemetry\/index\.js["']/.test(text) ||
        (path.dirname(file) === inFolder && /["']\.\/index\.js["']/.test(text)),
    );

    expect(importers.map(([file]) => file)).toEqual([path.join("lib", "telemetry", "TelemetryHost.jsx")]);
    const [[, host]] = importers;
    expect(host).toMatch(/import\("\.\/index\.js"\)/);
    expect(host).not.toMatch(/^import .* from "\.\/index\.js";$/m);
    expect(host).toMatch(/requestIdleCallback/);
  });
});
