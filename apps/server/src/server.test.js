import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertEnginesInCatalog,
  connectLeaderboardBonuses,
  connectMatchPipeline,
  handleFatalErrors,
  handleShutdownSignals,
  identityFollowers,
  startHousekeeping,
} from "./server.js";
import { createBackgroundTasks } from "./utils/backgroundTasks.js";
import { PROGRESSION_EVENTS } from "./domain/progression/progressionComponent.js";
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
  const match = { matchId: "m1", gameId: "rps", result: { reason: "best-of-1" }, credit: { notCounted: [] } };

  function setup({
    recordFinished,
    applyMatch,
    judge = async (recorded) => recorded,
    follow = async ({ match: recorded }) => recorded,
    applyGamification = vi.fn().mockResolvedValue(),
    applyToBoards = vi.fn().mockResolvedValue(),
  }) {
    const domainEvents = new EventEmitter();
    const capture = captureLogger();
    const tasks = createBackgroundTasks({ logger: capture.logger });
    connectMatchPipeline({
      domainEvents,
      matchComponent: { recordFinished, judge },
      playerTransferComponent: { follow },
      progressionComponent: { applyMatch },
      gamificationComponent: { applyMatch: applyGamification },
      leaderboardComponent: { applyMatch: applyToBoards },
      tasks,
      logger: capture.logger,
      now: () => 1_234,
    });
    return { domainEvents, tasks, ...capture };
  }

  it("records the match, applies progression, gamification, then the leaderboards — in that order", async () => {
    const recordFinished = vi.fn().mockResolvedValue(match);
    const updates = [{}, {}];
    const order = [];
    const applyMatch = vi.fn(async () => {
      order.push("progression");
      return updates;
    });
    const applyGamification = vi.fn(async () => {
      order.push("gamification");
    });
    const applyToBoards = vi.fn(async () => {
      order.push("leaderboards");
    });
    const { domainEvents, tasks, find } = setup({
      recordFinished,
      applyMatch,
      applyGamification,
      applyToBoards,
    });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await tasks.drain();

    expect(recordFinished).toHaveBeenCalledWith(event);
    expect(applyMatch).toHaveBeenCalledWith(match);
    expect(applyToBoards).toHaveBeenCalledWith({ match, updates });
    expect(order).toEqual(["progression", "gamification", "leaderboards"]);
    expect(find("match recorded")[0].matchId).toBe("m1");
    expect(find("progression applied")[0]).toEqual(expect.objectContaining({ matchId: "m1", players: 2 }));
    expect(find("leaderboards applied")[0].matchId).toBe("m1");
  });

  it("awards progression, gamification and leaderboards for the match as it stands after following players who just signed in (CC-032)", async () => {
    const moved = { ...match, players: [{ playerId: "user_1" }] };
    const follow = vi.fn().mockResolvedValue(moved);
    const updates = [{ playerId: "user_1" }];
    const applyMatch = vi.fn().mockResolvedValue(updates);
    const applyGamification = vi.fn().mockResolvedValue();
    const applyToBoards = vi.fn().mockResolvedValue();
    const { domainEvents, tasks } = setup({
      recordFinished: vi.fn().mockResolvedValue(match),
      applyMatch,
      follow,
      applyGamification,
      applyToBoards,
    });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await tasks.drain();

    expect(follow).toHaveBeenCalledWith({ match, now: 1_234 });
    expect(applyMatch).toHaveBeenCalledWith(moved);
    expect(applyGamification).toHaveBeenCalledWith({ match: moved, updates, now: 1_234 });
    expect(applyToBoards).toHaveBeenCalledWith({ match: moved, updates });
  });

  it("judges the followed match for fair play, and every later step gets the verdict (CC-095)", async () => {
    const moved = { ...match, players: [{ playerId: "user_1" }], credit: undefined };
    const judged = { ...moved, credit: { notCounted: [{ playerId: "user_1", reason: "ended-too-soon" }] } };
    const judge = vi.fn().mockResolvedValue(judged);
    const applyMatch = vi.fn().mockResolvedValue([]);
    const applyGamification = vi.fn().mockResolvedValue();
    const applyToBoards = vi.fn().mockResolvedValue();
    const { domainEvents, tasks, find } = setup({
      recordFinished: vi.fn().mockResolvedValue(match),
      follow: vi.fn().mockResolvedValue(moved),
      judge,
      applyMatch,
      applyGamification,
      applyToBoards,
    });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await tasks.drain();

    expect(judge).toHaveBeenCalledWith(moved);
    expect(applyMatch).toHaveBeenCalledWith(judged);
    expect(applyGamification).toHaveBeenCalledWith({ match: judged, updates: [], now: 1_234 });
    expect(applyToBoards).toHaveBeenCalledWith({ match: judged, updates: [] });
    expect(find("progression applied")[0].notCounted).toEqual(["ended-too-soon"]);
  });

  it("then counts the match for achievements, streaks and quests, with progression's updates", async () => {
    const updates = [{ playerId: "guest_a" }];
    const applyGamification = vi.fn().mockResolvedValue();
    const { domainEvents, tasks, find } = setup({
      recordFinished: vi.fn().mockResolvedValue(match),
      applyMatch: vi.fn().mockResolvedValue(updates),
      applyGamification,
    });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await tasks.drain();

    expect(applyGamification).toHaveBeenCalledWith({ match, updates, now: 1_234 });
    expect(find("gamification applied")[0].matchId).toBe("m1");
  });

  it("logs a failed gamification update with the match id, and still applies the leaderboards", async () => {
    const applyToBoards = vi.fn().mockResolvedValue();
    const { domainEvents, tasks, find } = setup({
      recordFinished: vi.fn().mockResolvedValue(match),
      applyMatch: vi.fn().mockResolvedValue([]),
      applyGamification: vi.fn().mockRejectedValue(new Error("db down")),
      applyToBoards,
    });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await tasks.drain();

    expect(find("progression applied")).toHaveLength(1);
    expect(find("background task failed")[0]).toEqual(
      expect.objectContaining({ task: "apply gamification", matchId: "m1" }),
    );
    expect(applyToBoards).toHaveBeenCalledWith({ match, updates: [] });
  });

  it("logs a failed leaderboard update with the match id", async () => {
    const { domainEvents, tasks, find } = setup({
      recordFinished: vi.fn().mockResolvedValue(match),
      applyMatch: vi.fn().mockResolvedValue([]),
      applyToBoards: vi.fn().mockRejectedValue(new Error("db down")),
    });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await tasks.drain();

    expect(find("gamification applied")).toHaveLength(1);
    expect(find("background task failed")[0]).toEqual(
      expect.objectContaining({ task: "apply leaderboards", matchId: "m1" }),
    );
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

describe("connectLeaderboardBonuses", () => {
  function setup(applyBonus) {
    const domainEvents = new EventEmitter();
    const capture = captureLogger();
    const tasks = createBackgroundTasks({ logger: capture.logger });
    connectLeaderboardBonuses({ domainEvents, leaderboardComponent: { applyBonus }, tasks, now: () => 1234 });
    return { domainEvents, tasks, ...capture };
  }

  it("puts quest XP on the leaderboards, at the time it was awarded", async () => {
    const applyBonus = vi.fn().mockResolvedValue();
    const { domainEvents, tasks } = setup(applyBonus);
    const award = { playerId: "user_a", source: "quest", key: "quest:2026-10-16:win-1", xpGained: 20 };

    domainEvents.emit(PROGRESSION_EVENTS.UPDATED, award);
    await tasks.drain();

    expect(applyBonus).toHaveBeenCalledWith({ ...award, at: 1234 });
  });

  it("leaves match XP to the match pipeline", async () => {
    const applyBonus = vi.fn();
    const { domainEvents, tasks } = setup(applyBonus);

    domainEvents.emit(PROGRESSION_EVENTS.UPDATED, { playerId: "user_a", matchId: "m1", xpGained: 30 });
    domainEvents.emit(PROGRESSION_EVENTS.UPDATED, { playerId: "user_a", source: "match", key: "m1" });
    await tasks.drain();

    expect(applyBonus).not.toHaveBeenCalled();
  });

  it("logs a failure with the award's key", async () => {
    const { domainEvents, tasks, find } = setup(vi.fn().mockRejectedValue(new Error("db down")));

    domainEvents.emit(PROGRESSION_EVENTS.UPDATED, { source: "quest", key: "quest:2026-10-16:sweep" });
    await tasks.drain();

    expect(find("background task failed")[0]).toEqual(
      expect.objectContaining({ task: "apply bonus to leaderboards", key: "quest:2026-10-16:sweep" }),
    );
  });
});

describe("startHousekeeping", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const idleTransfers = () => ({ resumePending: vi.fn(async () => ({ completed: [], failed: [] })) });

  function setup(roomComponent, playerTransferComponent = idleTransfers()) {
    vi.useFakeTimers();
    const capture = captureLogger();
    const housekeeping = startHousekeeping({
      roomComponent,
      playerTransferComponent,
      logger: capture.logger,
      now: () => 42,
    });
    return { housekeeping, playerTransferComponent, ...capture };
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

  it("logs a failing run and keeps going", async () => {
    const roomComponent = {
      sweepExpired: vi.fn(() => {
        throw new Error("sweep broke");
      }),
      expireDue: vi.fn(() => {
        throw new Error("clock broke");
      }),
    };
    const { housekeeping, find } = setup(roomComponent);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(find("room sweep failed")).toHaveLength(2);
    expect(find("applying game deadlines failed")).toHaveLength(120);
    housekeeping.stop();
  });

  it("does nothing more once stopped", () => {
    const roomComponent = { sweepExpired: vi.fn(), expireDue: vi.fn() };
    const { housekeeping, playerTransferComponent } = setup(roomComponent);

    housekeeping.stop();
    vi.advanceTimersByTime(120_000);

    expect(roomComponent.expireDue).not.toHaveBeenCalled();
    expect(roomComponent.sweepExpired).not.toHaveBeenCalled();
    expect(playerTransferComponent.resumePending).not.toHaveBeenCalled();
  });

  it("finishes interrupted guest transfers every minute and logs each one by player id (CC-032)", async () => {
    const roomComponent = { sweepExpired: vi.fn(), expireDue: vi.fn() };
    const transfers = {
      resumePending: vi.fn(async () => ({
        completed: ["guest_done"],
        failed: [{ from: "guest_stuck", error: new Error("still down") }],
      })),
    };
    const { housekeeping, find } = setup(roomComponent, transfers);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(transfers.resumePending).toHaveBeenCalledWith({ now: 42 });
    expect(find("guest transfer resumed and completed")[0].playerId).toBe("guest_done");
    expect(find("guest transfer failed again")[0]).toEqual(
      expect.objectContaining({
        playerId: "guest_stuck",
        err: expect.objectContaining({ message: "still down" }),
      }),
    );
    housekeeping.stop();
  });

  it("logs a failing transfer run and keeps going", async () => {
    const roomComponent = { sweepExpired: vi.fn(), expireDue: vi.fn() };
    const transfers = { resumePending: vi.fn().mockRejectedValue(new Error("database down")) };
    const { housekeeping, find } = setup(roomComponent, transfers);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(find("resuming guest transfers failed")).toHaveLength(2);
    housekeeping.stop();
  });
});

describe("identityFollowers", () => {
  const GUEST = { kind: "guest", id: "guest_a", displayName: "Guest-A1" };
  const USER = { kind: "user", id: "user_1", displayName: "Riya" };
  const CARRIED = { carriedOver: { xp: 30, matchesPlayed: 1, matches: 1 } };

  function setup(changedRooms = [{ code: "AB2CD3" }]) {
    const roomComponent = {
      transferPlayer: vi.fn(() => changedRooms),
      giveUpWaitingSeats: vi.fn(() => changedRooms),
    };
    const playerTransferComponent = { transfer: vi.fn(async () => CARRIED) };
    const domainEvents = new EventEmitter();
    const updates = [];
    domainEvents.on(ROOM_EVENTS.UPDATED, (event) => updates.push(event));
    const onIdentityChanged = identityFollowers({
      roomComponent,
      playerTransferComponent,
      domainEvents,
      now: () => 7,
    });
    return { onIdentityChanged, roomComponent, playerTransferComponent, updates };
  }

  it("moves a guest's seats to the account and tells each room", async () => {
    const { onIdentityChanged, roomComponent, updates } = setup();

    await onIdentityChanged({ previous: GUEST, identity: USER });

    expect(roomComponent.transferPlayer).toHaveBeenCalledWith({ from: GUEST.id, to: USER, now: 7 });
    expect(updates).toEqual([{ room: { code: "AB2CD3" } }]);
  });

  it("moves a guest's progress and history to the account, and answers what moved (CC-032)", async () => {
    const { onIdentityChanged, playerTransferComponent } = setup();

    const result = await onIdentityChanged({ previous: GUEST, identity: USER });

    expect(playerTransferComponent.transfer).toHaveBeenCalledWith({ from: GUEST.id, to: USER, now: 7 });
    expect(result).toEqual(CARRIED);
  });

  it.each([
    ["nobody was signed in", undefined],
    ["an account switches to another account", { kind: "user", id: "user_2", displayName: "Bo" }],
    ["the same identity signs in again", USER],
  ])("leaves rooms and data alone when %s", async (_case, previous) => {
    const { onIdentityChanged, roomComponent, playerTransferComponent } = setup();

    expect(await onIdentityChanged({ previous, identity: USER })).toEqual({});

    expect(roomComponent.transferPlayer).not.toHaveBeenCalled();
    expect(roomComponent.giveUpWaitingSeats).not.toHaveBeenCalled();
    expect(playerTransferComponent.transfer).not.toHaveBeenCalled();
  });

  it.each([GUEST, USER])(
    "gives up the waiting seats of whoever signs out (%o), and tells each room",
    async (previous) => {
      const { onIdentityChanged, roomComponent, playerTransferComponent, updates } = setup();

      expect(await onIdentityChanged({ previous, identity: undefined })).toEqual({});

      expect(roomComponent.giveUpWaitingSeats).toHaveBeenCalledWith({ playerId: previous.id, now: 7 });
      expect(roomComponent.transferPlayer).not.toHaveBeenCalled();
      expect(playerTransferComponent.transfer).not.toHaveBeenCalled();
      expect(updates).toEqual([{ room: { code: "AB2CD3" } }]);
    },
  );

  it("does nothing when a visitor without a session 'signs out'", async () => {
    const { onIdentityChanged, roomComponent } = setup();

    await onIdentityChanged({ previous: undefined, identity: undefined });

    expect(roomComponent.giveUpWaitingSeats).not.toHaveBeenCalled();
  });
});
