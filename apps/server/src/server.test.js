import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config/index.js";
import { handleShutdownSignals, startServer } from "./server.js";

const testConfig = (overrides = {}) => loadConfig({ NODE_ENV: "test", PORT: "0", ...overrides });

describe("startServer", () => {
  it("listens on the configured port and closes cleanly", async () => {
    const { server, port, close } = await startServer({ config: testConfig() });
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(await res.json()).toEqual({ status: "ok" });

    await close();
    // Assert on the server itself: probing the freed port is racy, because parallel test
    // workers can be handed the same ephemeral port by the OS (CC-075).
    expect(server.listening).toBe(false);
  });

  it("rejects when the port is already in use", async () => {
    const first = await startServer({ config: testConfig() });

    await expect(startServer({ config: testConfig({ PORT: String(first.port) }) })).rejects.toThrow(
      /EADDRINUSE/,
    );

    await first.close();
  });
});

describe("handleShutdownSignals", () => {
  const setup = (close) => {
    const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
    const logger = { log: vi.fn(), error: vi.fn() };
    handleShutdownSignals({ close, proc, logger, timeoutMs: 1_000 });
    return { proc, logger };
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["SIGINT", "SIGTERM"])("closes the server and exits 0 on %s", async (signal) => {
    const close = vi.fn().mockResolvedValue();
    const { proc } = setup(close);

    proc.emit(signal, signal);
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalled());

    expect(close).toHaveBeenCalledOnce();
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it("logs and exits 1 when closing fails", async () => {
    const failure = new Error("close failed");
    const { proc, logger } = setup(vi.fn().mockRejectedValue(failure));

    proc.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalled());

    expect(logger.error).toHaveBeenCalledWith("Error during shutdown", failure);
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it("forces exit 1 when connections do not drain in time", () => {
    vi.useFakeTimers();
    const { proc } = setup(() => new Promise(() => {}));

    proc.emit("SIGTERM", "SIGTERM");
    vi.advanceTimersByTime(1_000);

    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it("handles each signal only once", async () => {
    const close = vi.fn().mockResolvedValue();
    const { proc } = setup(close);

    proc.emit("SIGINT", "SIGINT");
    proc.emit("SIGINT", "SIGINT");
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalled());

    expect(close).toHaveBeenCalledOnce();
  });
});
