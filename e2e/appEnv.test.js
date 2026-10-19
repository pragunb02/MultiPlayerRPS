import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/server/src/config/index.js";
import { appEnv } from "./appEnv.js";
import { APP_PORT } from "./personas.js";

describe("the browser tests' app (CC-287)", () => {
  it("listens on loopback only, behind the HTTPS front", () => {
    const config = loadConfig(appEnv({ mongoUri: "mongodb://127.0.0.1:27017/e2e" }));

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(APP_PORT);
    expect(config.isProduction).toBe(true);
  });
});
