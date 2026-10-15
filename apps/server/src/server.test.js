import { describe, expect, it } from "vitest";
import { loadConfig } from "./config/index.js";
import { startServer } from "./server.js";

describe("startServer", () => {
  it("listens on the configured port and closes cleanly", async () => {
    const { port, close } = await startServer({ config: loadConfig({ NODE_ENV: "test", PORT: "0" }) });
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(await res.json()).toEqual({ status: "ok" });

    await close();
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
  });

  it("rejects when the port is already in use", async () => {
    const first = await startServer({ config: loadConfig({ NODE_ENV: "test", PORT: "0" }) });
    const config = loadConfig({ NODE_ENV: "test", PORT: String(first.port) });
    await expect(startServer({ config })).rejects.toThrow(/EADDRINUSE/);
    await first.close();
  });
});
