import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertEnginesInCatalog,
  connectMatchPipeline,
  handleFatalErrors,
  handleShutdownSignals,
  seatsFollowIdentity,
  startHousekeeping,
} from "./server.js";
import { createBackgroundTasks } from "./utils/backgroundTasks.js";
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

describe("connectMatchPipeline", () => {
  const event = { room: { code: "ROOM22" }, outcome: {} };
  const match = { matchId: "m1", gameId: "rps", result: { reason: "best-of-1" } };

  function setup({ recordFinished, applyMatch }) {
    const domainEvents = new EventEmitter();
    const capture = captureLogger();
    const tasks = createBackgroundTasks({ logger: capture.logger });
    connectMatchPipeline({
      domainEvents,
      matchComponent: { recordFinished },
      progressionComponent: { applyMatch },
      tasks,
      logger: capture.logger,
    });
    return { domainEvents, tasks, ...capture };
  }

  it("records the match, then applies progression from the recorded match", async () => {
    const recordFinished = vi.fn().mockResolvedValue(match);
    const applyMatch = vi.fn().mockResolvedValue([{}, {}]);
    const { domainEvents, tasks, find } = setup({ recordFinished, applyMatch });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await tasks.drain();

    expect(recordFinished).toHaveBeenCalledWith(event);
    expect(applyMatch).toHaveBeenCalledWith(match);
    expect(find("match recorded")[0].matchId).toBe("m1");
    expect(find("progression applied")[0]).toEqual(expect.objectContaining({ matchId: "m1", players: 2 }));
  });

  it("never awards progression when recording the match failed", async () => {
    const applyMatch = vi.fn();
    const { domainEvents, tasks, find } = setup({
      recordFinished: vi.fn().mockRejectedValue(new Error("db down")),
      applyMatch,
    });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await tasks.drain();

    expect(applyMatch).not.toHaveBeenCalled();
    expect(find("background task failed")[0]).toEqual(
      expect.objectContaining({ task: "record match", roomCode: "ROOM22" }),
    );
  });

  it("logs a failed progression update with the match id", async () => {
    const { domainEvents, tasks, find } = setup({
      recordFinished: vi.fn().mockResolvedValue(match),
      applyMatch: vi.fn().mockRejectedValue(new Error("db down")),
    });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await tasks.drain();

    expect(find("background task failed")[0]).toEqual(
      expect.objectContaining({ task: "apply progression", matchId: "m1" }),
    );
  });
});

describe("startHousekeeping", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(roomComponent) {
    vi.useFakeTimers();
    const capture = captureLogger();
    const housekeeping = startHousekeeping({ roomComponent, logger: capture.logger, now: () => 42 });
    return { housekeeping, ...capture };
  }

  it("applies game deadlines every second and sweeps idle rooms every minute", () => {
    const roomComponent = { sweepExpired: vi.fn(), expireDue: vi.fn() };
    const { housekeeping } = setup(roomComponent);

    vi.advanceTimersByTime(60_000);

    expect(roomComponent.expireDue).toHaveBeenCalledTimes(60);
    expect(roomComponent.expireDue).toHaveBeenLastCalledWith({ now: 42 });
    expect(roomComponent.sweepExpired).toHaveBeenCalledOnce();
    housekeeping.stop();
  });

  it("logs a failing run and keeps going", () => {
    const roomComponent = {
      sweepExpired: vi.fn(() => {
        throw new Error("sweep broke");
      }),
      expireDue: vi.fn(() => {
        throw new Error("clock broke");
      }),
    };
    const { housekeeping, find } = setup(roomComponent);

    vi.advanceTimersByTime(120_000);

    expect(find("room sweep failed")).toHaveLength(2);
    expect(find("applying game deadlines failed")).toHaveLength(120);
    housekeeping.stop();
  });

  it("does nothing more once stopped", () => {
    const roomComponent = { sweepExpired: vi.fn(), expireDue: vi.fn() };
    const { housekeeping } = setup(roomComponent);

    housekeeping.stop();
    vi.advanceTimersByTime(120_000);

    expect(roomComponent.expireDue).not.toHaveBeenCalled();
    expect(roomComponent.sweepExpired).not.toHaveBeenCalled();
  });
});

describe("seatsFollowIdentity", () => {
  const GUEST = { kind: "guest", id: "guest_a", displayName: "Guest-A1" };
  const USER = { kind: "user", id: "user_1", displayName: "Riya" };

  function setup(changedRooms = [{ code: "AB2CD3" }]) {
    const roomComponent = {
      transferPlayer: vi.fn(() => changedRooms),
      giveUpWaitingSeats: vi.fn(() => changedRooms),
    };
    const domainEvents = new EventEmitter();
    const updates = [];
    domainEvents.on(ROOM_EVENTS.UPDATED, (event) => updates.push(event));
    const onIdentityChanged = seatsFollowIdentity({ roomComponent, domainEvents, now: () => 7 });
    return { onIdentityChanged, roomComponent, updates };
  }

  it("moves a guest's seats to the account and tells each room", () => {
    const { onIdentityChanged, roomComponent, updates } = setup();

    onIdentityChanged({ previous: GUEST, identity: USER });

    expect(roomComponent.transferPlayer).toHaveBeenCalledWith({ from: GUEST.id, to: USER, now: 7 });
    expect(updates).toEqual([{ room: { code: "AB2CD3" } }]);
  });

  it.each([
    ["nobody was signed in", undefined],
    ["an account switches to another account", { kind: "user", id: "user_2", displayName: "Bo" }],
    ["the same identity signs in again", USER],
  ])("leaves rooms alone when %s", (_case, previous) => {
    const { onIdentityChanged, roomComponent } = setup();

    onIdentityChanged({ previous, identity: USER });

    expect(roomComponent.transferPlayer).not.toHaveBeenCalled();
    expect(roomComponent.giveUpWaitingSeats).not.toHaveBeenCalled();
  });

  it.each([GUEST, USER])(
    "gives up the waiting seats of whoever signs out (%o), and tells each room",
    (previous) => {
      const { onIdentityChanged, roomComponent, updates } = setup();

      onIdentityChanged({ previous, identity: undefined });

      expect(roomComponent.giveUpWaitingSeats).toHaveBeenCalledWith({ playerId: previous.id, now: 7 });
      expect(roomComponent.transferPlayer).not.toHaveBeenCalled();
      expect(updates).toEqual([{ room: { code: "AB2CD3" } }]);
    },
  );

  it("does nothing when a visitor without a session 'signs out'", () => {
    const { onIdentityChanged, roomComponent } = setup();

    onIdentityChanged({ previous: undefined, identity: undefined });

    expect(roomComponent.giveUpWaitingSeats).not.toHaveBeenCalled();
  });
});
