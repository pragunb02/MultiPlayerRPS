import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({})).toEqual({ env: "development", isProduction: false, port: 4000 });
  });

  it("reads values from the environment", () => {
    expect(loadConfig({ NODE_ENV: "production", PORT: "8000" })).toEqual({
      env: "production",
      isProduction: true,
      port: 8000,
    });
  });

  it("reports every invalid value at once", () => {
    expect(() => loadConfig({ NODE_ENV: "staging", PORT: "abc" })).toThrow(
      /NODE_ENV must be one of[\s\S]*PORT must be an integer/,
    );
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });
});
