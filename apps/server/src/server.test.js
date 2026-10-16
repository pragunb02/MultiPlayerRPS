import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertEnginesInCatalog,
  handleFatalErrors,
  handleShutdownSignals,
  recordFinishedMatches,
} from "./server.js";
import { ROOM_EVENTS } from "./domain/rooms/roomComponent.js";
import { captureLogger } from "./testing/captureLogger.js";

const fakeProcess = () => Object.assign(new EventEmitter(), { exit: vi.fn() });

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

describe("assertEnginesInCatalog", () => {
  it("accepts engines that are listed in the public game catalog", () => {
    expect(() => assertEnginesInCatalog([{ id: "rps" }, { id: "chess" }])).not.toThrow();
  });

  it("refuses to boot with an engine that is missing from the catalog", () => {
    expect(() => assertEnginesInCatalog([{ id: "rps" }, { id: "race" }])).toThrow(
      /missing from the game catalog: race/,
    );
  });
});

describe("recordFinishedMatches", () => {
  const event = { room: { code: "ROOM22" }, outcome: {} };

  it("records each finished game in the background and logs it", async () => {
    const domainEvents = new EventEmitter();
    const { logger, find } = captureLogger();
    const recordFinished = vi
      .fn()
      .mockResolvedValue({ matchId: "m1", gameId: "rps", result: { reason: "best-of-1" } });
    const recorder = recordFinishedMatches({ domainEvents, matchComponent: { recordFinished }, logger });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await recorder.drain();

    expect(recordFinished).toHaveBeenCalledWith(event);
    expect(find("match recorded")[0]).toEqual(expect.objectContaining({ matchId: "m1", gameId: "rps" }));
  });

  it("logs a failed write instead of crashing the game", async () => {
    const domainEvents = new EventEmitter();
    const { logger, find } = captureLogger();
    const recorder = recordFinishedMatches({
      domainEvents,
      matchComponent: { recordFinished: vi.fn().mockRejectedValue(new Error("db down")) },
      logger,
    });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await recorder.drain();

    expect(find("failed to record match")[0]).toEqual(
      expect.objectContaining({ roomCode: "ROOM22", level: 50 }),
    );
  });

  it("lets shutdown wait for writes still in flight", async () => {
    const domainEvents = new EventEmitter();
    let finishWrite;
    const recordFinished = () => new Promise((resolve) => (finishWrite = resolve));
    const recorder = recordFinishedMatches({
      domainEvents,
      matchComponent: { recordFinished },
      logger: captureLogger().logger,
    });
    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    let drained = false;

    const draining = recorder.drain().then(() => (drained = true));
    await Promise.resolve();
    expect(drained).toBe(false);
    finishWrite({ matchId: "m1", gameId: "rps", result: { reason: "x" } });
    await draining;

    expect(drained).toBe(true);
  });
});
