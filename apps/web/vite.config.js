import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { bundleReport } from "../../scripts/build/bundleReport.mjs";
import { routeFiles } from "../../scripts/build/routeFiles.mjs";
import { buildStamp } from "./src/app/buildStamp.js";

// In development the API server runs on :4000 (npm run dev:server). Proxying keeps the app same-origin, exactly
// like production (the server serves the built app), so session cookies and origin checks behave identically.
const API_TARGET = process.env.CLASSICADE_API ?? "http://localhost:4000";

// The build's name, which in-app feedback carries (CC-290). Render gives the commit at build time.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const APP_BUILD = buildStamp({ version, commit: process.env.RENDER_GIT_COMMIT });

// What each chunk holds, for the bundle size check in CI (scripts/bin/check-bundle.mjs, CC-322). Outside dist, so
// the server never serves it.
const BUNDLE_REPORT = fileURLToPath(new URL("./bundle-report.json", import.meta.url));

export default defineConfig({
  // routeFiles: each page's files in index.html, for the link hints of app/routeFiles.js (CC-322).
  plugins: [react(), bundleReport({ file: BUNDLE_REPORT }), routeFiles()],
  define: { "import.meta.env.VITE_APP_BUILD": JSON.stringify(APP_BUILD) },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
      "/socket.io": { target: API_TARGET, ws: true, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
