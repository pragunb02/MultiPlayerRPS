import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/index.js";

/** A built web app with just an index.html, shaped like the real build (apps/web/index.html). */
export const TEST_WEB_BUILD = fileURLToPath(new URL("./webBuild", import.meta.url));

/** Minimal valid environment for tests; override any variable per test. */
export const TEST_ENV = Object.freeze({
  NODE_ENV: "test",
  PORT: "0",
  MONGO_URI: "mongodb://127.0.0.1:27017/classicade-test",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-chars",
  ALLOWED_ORIGINS: "http://localhost:5173",
});

/** Overrides that make a valid production environment. */
export const PRODUCTION_ENV = Object.freeze({
  NODE_ENV: "production",
  ALLOWED_ORIGINS: "https://classicade.app",
  WEB_DIST_DIR: TEST_WEB_BUILD,
});

/** @param {Record<string, string>} [overrides] */
export const testConfig = (overrides = {}) => loadConfig({ ...TEST_ENV, ...overrides });
