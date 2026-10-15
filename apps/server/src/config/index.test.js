import { describe, expect, it } from "vitest";
import { TEST_ENV } from "../testing/testConfig.js";
import { loadConfig } from "./index.js";

const REQUIRED = {
  MONGO_URI: "mongodb://localhost:27017/classicade",
  SESSION_SECRET: "x".repeat(32),
};

describe("loadConfig", () => {
  it("applies documented defaults when only required values are set", () => {
    expect(loadConfig(REQUIRED)).toEqual({
      env: "development",
      isProduction: false,
      port: 4000,
      logLevel: "info",
      mongoUri: REQUIRED.MONGO_URI,
      sessionSecret: REQUIRED.SESSION_SECRET,
      allowedOrigins: ["http://localhost:4000", "http://localhost:5173"],
    });
  });

  it("reads every value from the environment", () => {
    const config = loadConfig({
      ...REQUIRED,
      NODE_ENV: "production",
      PORT: "8000",
      LOG_LEVEL: "warn",
      MONGO_URI: "mongodb+srv://cluster.example.net/classicade",
      ALLOWED_ORIGINS: "https://classicade.app, https://www.classicade.app",
    });

    expect(config).toEqual(
      expect.objectContaining({
        env: "production",
        isProduction: true,
        port: 8000,
        logLevel: "warn",
        mongoUri: "mongodb+srv://cluster.example.net/classicade",
        allowedOrigins: ["https://classicade.app", "https://www.classicade.app"],
      }),
    );
  });

  it("silences logs by default in tests, but honours an explicit LOG_LEVEL", () => {
    expect(loadConfig({ ...REQUIRED, NODE_ENV: "test" }).logLevel).toBe("silent");
    expect(loadConfig({ ...REQUIRED, NODE_ENV: "test", LOG_LEVEL: "debug" }).logLevel).toBe("debug");
  });

  it.each([
    [{ MONGO_URI: undefined }, /MONGO_URI is required/],
    [{ MONGO_URI: "postgres://db" }, /MONGO_URI is required/],
    [{ SESSION_SECRET: undefined }, /SESSION_SECRET is required/],
    [{ SESSION_SECRET: "too-short" }, /at least 32 characters/],
    [{ NODE_ENV: "production" }, /ALLOWED_ORIGINS is required in production/],
    [{ ALLOWED_ORIGINS: "not a url" }, /ALLOWED_ORIGINS must be/],
    [{ ALLOWED_ORIGINS: "https://classicade.app/path" }, /ALLOWED_ORIGINS must be/],
    [{ ALLOWED_ORIGINS: "ftp://classicade.app" }, /ALLOWED_ORIGINS must be/],
    [{ ALLOWED_ORIGINS: " , " }, /ALLOWED_ORIGINS must be/],
  ])("rejects %o", (overrides, message) => {
    expect(() => loadConfig({ ...REQUIRED, ...overrides })).toThrow(message);
  });

  it("reports every invalid value at once", () => {
    expect(() => loadConfig({ NODE_ENV: "staging", PORT: "abc", LOG_LEVEL: "loud" })).toThrow(
      /NODE_ENV[\s\S]*PORT[\s\S]*LOG_LEVEL[\s\S]*MONGO_URI[\s\S]*SESSION_SECRET/,
    );
  });

  it("returns frozen values", () => {
    const config = loadConfig(TEST_ENV);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.allowedOrigins)).toBe(true);
  });
});
