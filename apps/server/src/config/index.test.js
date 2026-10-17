import path from "node:path";
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
      webDistDir: "",
      trustProxyHops: 0,
      adminAccountIds: [],
    });
  });

  it("reads the owner console's account ids, trimmed and without repeats", () => {
    const { adminAccountIds } = loadConfig({
      ...REQUIRED,
      ADMIN_ACCOUNT_IDS:
        " user_65f0c2a1b2c3d4e5f6a7b8c9 ,user_000000000000000000000001,user_65f0c2a1b2c3d4e5f6a7b8c9,",
    });

    expect(adminAccountIds).toEqual(["user_65f0c2a1b2c3d4e5f6a7b8c9", "user_000000000000000000000001"]);
    expect(Object.isFrozen(adminAccountIds)).toBe(true);
    expect(loadConfig({ ...REQUIRED, ADMIN_ACCOUNT_IDS: "" }).adminAccountIds).toEqual([]);
  });

  it("refuses an admin id that is not an account id, such as a guest or a bare hex id", () => {
    expect(() =>
      loadConfig({ ...REQUIRED, ADMIN_ACCOUNT_IDS: "guest_00000000-0000-4000-8000-000000000001" }),
    ).toThrow(/ADMIN_ACCOUNT_IDS must be a comma separated list of account ids/);
    expect(() => loadConfig({ ...REQUIRED, ADMIN_ACCOUNT_IDS: "65f0c2a1b2c3d4e5f6a7b8c9" })).toThrow(
      /got "65f0c2a1b2c3d4e5f6a7b8c9"/,
    );
  });

  it("reads every value from the environment", () => {
    const config = loadConfig({
      ...REQUIRED,
      NODE_ENV: "production",
      PORT: "8000",
      LOG_LEVEL: "warn",
      MONGO_URI: "mongodb+srv://cluster.example.net/classicade",
      ALLOWED_ORIGINS: "https://classicade.app, https://www.classicade.app",
      WEB_DIST_DIR: "apps/web/dist",
      TRUST_PROXY_HOPS: "2",
    });

    expect(config).toEqual(
      expect.objectContaining({
        env: "production",
        isProduction: true,
        port: 8000,
        logLevel: "warn",
        mongoUri: "mongodb+srv://cluster.example.net/classicade",
        allowedOrigins: ["https://classicade.app", "https://www.classicade.app"],
        webDistDir: path.resolve("apps/web/dist"),
        trustProxyHops: 2,
      }),
    );
  });

  it("resolves a relative WEB_DIST_DIR against the working directory", () => {
    const { webDistDir } = loadConfig({ ...REQUIRED, WEB_DIST_DIR: "apps/web/dist" });

    expect(webDistDir).toBe(path.join(process.cwd(), "apps", "web", "dist"));
    expect(loadConfig({ ...REQUIRED, WEB_DIST_DIR: "/srv/web" }).webDistDir).toBe("/srv/web");
  });

  it("silences logs by default in tests, but honours an explicit LOG_LEVEL", () => {
    expect(loadConfig({ ...REQUIRED, NODE_ENV: "test" }).logLevel).toBe("silent");
    expect(loadConfig({ ...REQUIRED, NODE_ENV: "test", LOG_LEVEL: "debug" }).logLevel).toBe("debug");
  });

  it("trusts one proxy by default in production and none elsewhere", () => {
    const production = {
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://classicade.app",
      WEB_DIST_DIR: "/srv",
    };

    expect(loadConfig({ ...REQUIRED, ...production }).trustProxyHops).toBe(1);
    expect(loadConfig({ ...REQUIRED, NODE_ENV: "test" }).trustProxyHops).toBe(0);
    expect(loadConfig({ ...REQUIRED, TRUST_PROXY_HOPS: "0" }).trustProxyHops).toBe(0);
    expect(loadConfig({ ...REQUIRED, TRUST_PROXY_HOPS: " 5 " }).trustProxyHops).toBe(5);
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
    [{ TRUST_PROXY_HOPS: "6" }, /TRUST_PROXY_HOPS must be a whole number from 0 to 5 \(got "6"\)/],
    [{ TRUST_PROXY_HOPS: "-1" }, /TRUST_PROXY_HOPS must be/],
    [{ TRUST_PROXY_HOPS: "1.5" }, /TRUST_PROXY_HOPS must be/],
    [{ TRUST_PROXY_HOPS: "true" }, /TRUST_PROXY_HOPS must be/],
    [{ TRUST_PROXY_HOPS: "" }, /TRUST_PROXY_HOPS must be/],
    [
      {
        NODE_ENV: "production",
        ALLOWED_ORIGINS: "https://classicade.app",
        WEB_DIST_DIR: "/srv",
        TRUST_PROXY_HOPS: "0",
      },
      /TRUST_PROXY_HOPS must be a whole number from 1 to 5 in production/,
    ],
    [{ WEB_DIST_DIR: "  " }, /WEB_DIST_DIR, when set, must be a directory path/],
    [
      { NODE_ENV: "production", ALLOWED_ORIGINS: "https://classicade.app" },
      /WEB_DIST_DIR is required in production/,
    ],
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
