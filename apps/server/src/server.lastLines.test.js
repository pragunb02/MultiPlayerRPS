import { EventEmitter } from "node:events";
import { AggregationTemporality, InMemoryMetricExporter } from "@opentelemetry/sdk-metrics";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTelemetry } from "./dependency/telemetry/telemetry.js";
import { handleFatalErrors, handleShutdownSignals, MATCH_STEPS } from "./server.js";
import { createLogger } from "./utils/logger.js";

// CC-305: the last line of every way out of the process reaches the log exporter before the process exits. The
// telemetry is the real one, with a batch far longer than a test, so a line arrives only if it is flushed.
const SETTINGS = Object.freeze({
  enabled: true,
  endpoint: "http://127.0.0.1:1",
  logs: true,
  exportIntervalMs: 60_000,
  serviceVersion: "0123456789ab",
  environment: "test",
});
const running = [];

afterEach(async () => {
  for (const telemetry of running.splice(0)) await telemetry.shutdown();
});

/** A log exporter that keeps what it was sent. The SDK's in-memory one forgets everything when it shuts down. */
function keepingLogExporter() {
  const bodies = [];
  return {
    bodies,
    export(records, done) {
      bodies.push(...records.map((record) => record.body));
      done({ code: 0 });
    },
    forceFlush: async () => undefined,
    shutdown: async () => undefined,
  };
}

/** The real telemetry and logger, and a process whose `exit` notes which lines had reached the exporter. */
async function setup() {
  const logs = keepingLogExporter();
  const telemetry = await startTelemetry({
    settings: SETTINGS,
    matchSteps: Object.values(MATCH_STEPS),
    onExportFailed: () => undefined,
    exporters: { metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE), logs },
  });
  running.push(telemetry);
  const logger = createLogger({
    level: "info",
    destination: { write: () => undefined },
    forward: telemetry.forward,
  });
  const exits = [];
  const proc = Object.assign(new EventEmitter(), {
    exit: vi.fn((code) => exits.push({ code, exported: [...logs.bodies] })),
  });
  return { telemetry, logger, proc, exits };
}

describe("the last line of every way out reaches the log exporter before exit (CC-305)", () => {
  it("sends `shutdown complete` after a clean shutdown", async () => {
    const { telemetry, logger, proc, exits } = await setup();
    handleShutdownSignals({ close: async () => undefined, flush: telemetry.shutdown, logger, proc });

    proc.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => expect(exits).toHaveLength(1));

    expect(exits[0]).toEqual({ code: 0, exported: ["shutting down", "shutdown complete"] });
  });

  it("sends `error during shutdown`, and everything before it, when closing the server fails", async () => {
    const { telemetry, logger, proc, exits } = await setup();
    const close = async () => {
      throw new Error("close failed");
    };
    handleShutdownSignals({ close, flush: telemetry.shutdown, logger, proc });

    proc.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => expect(exits).toHaveLength(1));

    expect(exits[0]).toEqual({ code: 1, exported: ["shutting down", "error during shutdown"] });
  });

  it("sends `shutdown timed out, forcing exit` when connections do not drain in time", async () => {
    const { telemetry, logger, proc, exits } = await setup();
    handleShutdownSignals({
      close: () => new Promise(() => {}),
      flush: telemetry.shutdown,
      logger,
      proc,
      timeoutMs: 20,
    });

    proc.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => expect(exits).toHaveLength(1));

    expect(exits[0]).toEqual({ code: 1, exported: ["shutting down", "shutdown timed out, forcing exit"] });
  });

  it.each([
    ["uncaughtException", "uncaught exception"],
    ["unhandledRejection", "unhandled promise rejection"],
  ])("sends the line for %s", async (event, message) => {
    const { telemetry, logger, proc, exits } = await setup();
    handleFatalErrors({ logger, flush: telemetry.shutdown, proc });

    proc.emit(event, new Error("kaboom"));
    await vi.waitFor(() => expect(exits).toHaveLength(1));

    expect(exits[0]).toEqual({ code: 1, exported: [message] });
  });
});
