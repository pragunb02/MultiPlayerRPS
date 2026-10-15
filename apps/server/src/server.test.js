import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config/index.js";
import { handleFatalErrors, handleShutdownSignals, startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";

const testConfig = (overrides = {}) => loadConfig({ NODE_ENV: "test", PORT: "0", ...overrides });
const fakeProcess = () => Object.assign(new EventEmitter(), { exit: vi.fn() });

describe("startServer", () => {
  it("listens on the configured port, serves requests and closes cleanly", async () => {
    const { logger } = captureLogger();
    const { server, port, close } = await startServer({ config: testConfig(), logger });
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(await res.json()).toEqual({ status: "ok" });

    await close();
    // Assert on the server itself: probing the freed port is racy, because parallel test
    // workers can be handed the same ephemeral port by the OS (CC-075).
    expect(server.listening).toBe(false);
  });

  it("rejects when the port is already in use", async () => {
    const { logger } = captureLogger();
    const first = await startServer({ config: testConfig(), logger });

    await expect(startServer({ config: testConfig({ PORT: String(first.port) }), logger })).rejects.toThrow(
      /EADDRINUSE/,
    );

    await first.close();
  });
});

describe("handleShutdownSignals", () => {
  const setup = (close) => {
    const proc = fakeProcess();
    const capture = captureLogger();
    handleShutdownSignals({ close, logger: capture.logger, proc, timeoutMs: 1_000 });
    return { proc, ...capture };
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["SIGINT", "SIGTERM"])("closes the server and exits 0 on %s", async (signal) => {
    const close = vi.fn().mockResolvedValue();
    const { proc, find } = setup(close);

    proc.emit(signal, signal);
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalled());

    expect(close).toHaveBeenCalledOnce();
    expect(proc.exit).toHaveBeenCalledWith(0);
    expect(find("shutting down")[0].signal).toBe(signal);
    expect(find("shutdown complete")).toHaveLength(1);
  });

  it("logs and exits 1 when closing fails", async () => {
    const { proc, find } = setup(vi.fn().mockRejectedValue(new Error("close failed")));

    proc.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalled());

    expect(find("error during shutdown")[0].err.message).toBe("close failed");
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it("forces exit 1 when connections do not drain in time", () => {
    vi.useFakeTimers();
    const { proc, find } = setup(() => new Promise(() => {}));

    proc.emit("SIGTERM", "SIGTERM");
    vi.advanceTimersByTime(1_000);

    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(find("shutdown timed out, forcing exit")).toHaveLength(1);
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

describe("handleFatalErrors", () => {
  it.each([
    ["uncaughtException", "uncaught exception"],
    ["unhandledRejection", "unhandled promise rejection"],
  ])("logs %s as fatal and exits 1", (event, message) => {
    const proc = fakeProcess();
    const { logger, find } = captureLogger();
    handleFatalErrors({ logger, proc });

    proc.emit(event, new Error("kaboom"));

    const [entry] = find(message);
    expect(entry.level).toBe(60);
    expect(entry.err.message).toBe("kaboom");
    expect(proc.exit).toHaveBeenCalledWith(1);
  });
});
