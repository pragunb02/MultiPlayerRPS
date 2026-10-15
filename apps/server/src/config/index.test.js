import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({})).toEqual({ env: "development", isProduction: false, port: 4000, logLevel: "info" });
  });

  it("reads values from the environment", () => {
    expect(loadConfig({ NODE_ENV: "production", PORT: "8000", LOG_LEVEL: "warn" })).toEqual({
      env: "production",
      isProduction: true,
      port: 8000,
      logLevel: "warn",
    });
  });

  it("silences logs by default in tests, but honours an explicit LOG_LEVEL", () => {
    expect(loadConfig({ NODE_ENV: "test" }).logLevel).toBe("silent");
    expect(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "debug" }).logLevel).toBe("debug");
  });

  it("reports every invalid value at once", () => {
    expect(() => loadConfig({ NODE_ENV: "staging", PORT: "abc", LOG_LEVEL: "loud" })).toThrow(
      /NODE_ENV must be one of[\s\S]*PORT must be an integer[\s\S]*LOG_LEVEL must be one of/,
    );
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });
});
