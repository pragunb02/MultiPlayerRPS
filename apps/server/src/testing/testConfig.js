import { loadConfig } from "../config/index.js";

/** Minimal valid environment for tests; override any variable per test. */
export const TEST_ENV = Object.freeze({
  NODE_ENV: "test",
  PORT: "0",
  MONGO_URI: "mongodb://127.0.0.1:27017/classicade-test",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-chars",
  ALLOWED_ORIGINS: "http://localhost:5173",
});

/** Overrides that make a valid production environment (the web build path is never read by these tests). */
export const PRODUCTION_ENV = Object.freeze({
  NODE_ENV: "production",
  ALLOWED_ORIGINS: "https://classicade.app",
  WEB_DIST_DIR: "/srv/classicade/web",
});

/** @param {Record<string, string>} [overrides] */
export const testConfig = (overrides = {}) => loadConfig({ ...TEST_ENV, ...overrides });
