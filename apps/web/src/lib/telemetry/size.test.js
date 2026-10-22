import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../..");
const web = path.resolve(src, "..");
/**
 * The budget of the client's own file, gzipped (CC-174). It was 4 KB while the shared catalogue loaded with the first
 * page. Since CC-322 the catalogue and the field rules load with the client, which checks every event against them
 * (ADR-034), so the design lead set 5.5 KB for this file, which loads only when the browser is idle
 * (docs/tickets/CC-174.md).
 */
const BUDGET_BYTES = 5.5 * 1024;

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
  it("the client's own file stays under its budget gzipped", async () => {
    // The file the production build makes for the client, which loads when the browser is idle: the app is built as
    // in production and the chunk whose entry is index.js is measured, with every module the build puts in it.
    const output = await build({
      configFile: false,
      root: web,
      logLevel: "silent",
      plugins: [react()],
      build: { write: false },
    });
    const [{ output: files }] = /** @type {any} */ (Array.isArray(output) ? output : [output]);
    const chunk = files.find(
      (file) => file.type === "chunk" && file.facadeModuleId?.endsWith("src/lib/telemetry/index.js"),
    );
    const gzipped = gzipSync(chunk.code).length;

    // eslint-disable-next-line no-console
    console.info(`telemetry client: ${chunk.code.length} bytes minified, ${gzipped} bytes gzipped`);
    expect(gzipped).toBeGreaterThan(500);
    expect(gzipped).toBeLessThan(BUDGET_BYTES);
  }, 120_000);

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
    expect(host).toMatch(/whenIdle\(/);
  });
});
