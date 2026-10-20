import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertEnginesInCatalog,
  connectLeaderboardBonuses,
  connectMatchPipeline,
  handleFatalErrors,
  handleShutdownSignals,
  identityFollowers,
  logPipelineOutcome,
  MATCH_STEPS,
  matchPipelineSteps,
  reportOldEmailSpellings,
  roomErasure,
  startHousekeeping,
} from "./server.js";
import { createPendingMatchAccessor } from "./data/pendingMatchAccessor.js";
import { GUEST_ROW_LIFETIME_MS } from "./domain/leaderboards/boards.js";
import { SESSION_TTL_SECONDS } from "./service/http/session.js";
import { createMatchOutboxComponent, matchRetryPolicy } from "./domain/matches/matchOutboxComponent.js";
import { createInMemoryPendingMatchDao } from "./testing/inMemoryPendingMatchDao.js";
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

describe("the match pipeline (CC-111)", () => {
  const T = 1_234;
  const room = { code: "ROOM22" };
  const event = { room, outcome: {} };
  const finished = Object.freeze({
    matchId: "m1",
    gameId: "rps",
    result: { reason: "best-of-1" },
    players: [],
  });
  const judged = Object.freeze({
    ...finished,
    credit: { notCounted: [{ playerId: "p", reason: "ended-too-soon" }] },
  });

  /**
   * The real outbox over the in-memory store, with fake components. Each component call is recorded in `calls`,
   * in order. `fail` names steps that throw, and how often. `ratings` is what the chess rating step answers.
   */
  function setup({ fail = {}, finishedGames = [], ratings = [] } = {}) {
    const calls = [];
    const left = { ...fail };
    const call = (name, args, result) => {
      calls.push([name, args]);
      if ((left[name] ?? 0) > 0) {
        left[name] -= 1;
        return Promise.reject(new Error(`${name} down`));
      }
      return Promise.resolve(result);
    };
    const matchComponent = {
      finishedMatch: ({ room: from }) => ({ ...finished, roomCode: from.code }),
      record: (match) => call("record", match, finished),
      getById: async () => judged,
      judge: (match) => call("judge", match, judged),
    };
    const capture = captureLogger();
    const tasks = createBackgroundTasks({ logger: capture.logger });
    const steps = matchPipelineSteps({
      matchComponent,
      playerTransferComponent: { follow: (input) => call("follow", input, judged) },
      progressionComponent: { applyMatch: (match) => call("progression", match, [{}, {}]) },
      gamificationComponent: { applyMatch: (input) => call("gamification", input) },
      leaderboardComponent: { applyMatch: (input) => call("leaderboards", input) },
      chessRatingComponent: { applyMatch: (input) => call("chessRatings", input, ratings) },
      logger: capture.logger,
    });
    const pendingMatchAccessor = createPendingMatchAccessor({
      pendingMatchDao: createInMemoryPendingMatchDao(),
    });
    const outbox = createMatchOutboxComponent({
      pendingMatchAccessor,
      steps,
      policy: matchRetryPolicy({ firstDelayMs: 1_000, maxDelayMs: 1_000, maxAttempts: 2 }),
    });
    let now = T;
    const domainEvents = new EventEmitter();
    const pipeline = connectMatchPipeline({
      domainEvents,
      matchComponent,
      roomComponent: { listFinishedGames: async () => finishedGames },
      outbox,
      tasks,
      logger: capture.logger,
      now: () => now,
    });
    const finish = async () => {
      domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
      await tasks.drain();
    };
    const later = async (ms) => {
      now += ms;
      pipeline.runDue();
      await tasks.drain();
    };
    const names = () => calls.map(([name]) => name);
    return { steps, calls, names, finish, later, pipeline, pendingMatchAccessor, tasks, ...capture };
  }

  it("has six named steps in order, the boards needing progression and the ratings only the verdict", () => {
    const { steps } = setup();

    expect(steps.map(({ name, needs = [] }) => [name, needs])).toEqual([
      [MATCH_STEPS.RECORD, []],
      [MATCH_STEPS.JUDGE, [MATCH_STEPS.RECORD]],
      [MATCH_STEPS.PROGRESSION, [MATCH_STEPS.JUDGE]],
      [MATCH_STEPS.GAMIFICATION, [MATCH_STEPS.PROGRESSION]],
      [MATCH_STEPS.LEADERBOARDS, [MATCH_STEPS.PROGRESSION]],
      [MATCH_STEPS.CHESS_RATINGS, [MATCH_STEPS.JUDGE]],
    ]);
  });

  it("records a finished game, follows and judges it, then applies progression, gamification and boards", async () => {
    const { calls, names, finish, find, pendingMatchAccessor } = setup();

    await finish();

    expect(names()).toEqual([
      "record",
      "follow",
      "judge",
      "progression",
      "gamification",
      "leaderboards",
      "chessRatings",
    ]);
    expect(calls[0][1]).toEqual({ ...finished, roomCode: "ROOM22" });
    expect(calls[1][1]).toEqual({ match: judged, now: T });
    expect(calls[3][1]).toBe(judged);
    expect(calls[4][1]).toEqual({ match: judged, now: T });
    expect(calls[5][1]).toEqual({ match: judged });
    expect(calls[6][1]).toEqual({ match: judged });
    expect(find("match recorded")[0]).toEqual(
      expect.objectContaining({ matchId: "m1", reason: "best-of-1" }),
    );
    expect(find("progression applied")[0]).toEqual(
      expect.objectContaining({ matchId: "m1", players: 2, notCounted: ["ended-too-soon"] }),
    );
    expect(find("gamification applied")[0].matchId).toBe("m1");
    expect(find("leaderboards applied")[0].matchId).toBe("m1");
    expect(find("chess ratings applied")).toEqual([]);
    expect(find("match pipeline done")[0].steps).toHaveLength(6);
    expect((await pendingMatchAccessor.get("m1")).status).toBe("done");
  });

  it("never awards anything while recording fails, and retries it later", async () => {
    const { names, finish, later, find } = setup({ fail: { record: 1 } });

    await finish();
    const afterFailure = names();
    await later(1_000);

    expect(afterFailure).toEqual(["record"]);
    expect(find("match pipeline step failed, will retry")[0]).toEqual(
      expect.objectContaining({
        matchId: "m1",
        step: MATCH_STEPS.RECORD,
        attempts: 1,
        nextAttemptAt: T + 1_000,
      }),
    );
    expect(names().slice(1)).toEqual([
      "record",
      "follow",
      "judge",
      "progression",
      "gamification",
      "leaderboards",
      "chessRatings",
    ]);
  });

  it("still applies the boards when gamification fails, and later retries only gamification", async () => {
    const { names, finish, later } = setup({ fail: { gamification: 1 } });

    await finish();
    await later(1_000);

    expect(names()).toEqual([
      "record",
      "follow",
      "judge",
      "progression",
      "gamification",
      "leaderboards",
      "chessRatings",
      "gamification",
    ]);
  });

  it("logs the chess ratings a game changed", async () => {
    const { finish, find } = setup({ ratings: [{}, {}] });

    await finish();

    expect(find("chess ratings applied")).toEqual([expect.objectContaining({ matchId: "m1", players: 2 })]);
  });

  it("still rates a chess game when progression fails", async () => {
    const { names, finish } = setup({ fail: { progression: 1 } });

    await finish();

    expect(names()).toEqual(["record", "follow", "judge", "progression", "chessRatings"]);
  });

  it("logs a game that failed for good at error level, as the alert", async () => {
    const { finish, later, find } = setup({ fail: { progression: 9 } });

    await finish();
    await later(1_000);
    await later(60_000);

    const [alert] = find("match pipeline failed");
    expect(alert).toEqual(
      expect.objectContaining({
        level: 50,
        matchId: "m1",
        step: MATCH_STEPS.PROGRESSION,
        attempts: 2,
        alert: true,
      }),
    );
    expect(alert.err.message).toBe("progression down");
    expect(find("match pipeline failed")).toHaveLength(1);
  });

  it("logs a failure to reach the outbox at all as a failed background task, with the match", async () => {
    const capture = captureLogger();
    const tasks = createBackgroundTasks({ logger: capture.logger });
    const domainEvents = new EventEmitter();
    connectMatchPipeline({
      domainEvents,
      matchComponent: { finishedMatch: () => finished },
      roomComponent: { listFinishedGames: async () => [] },
      outbox: { add: async () => Promise.reject(new Error("db down")) },
      tasks,
      logger: capture.logger,
    });

    domainEvents.emit(ROOM_EVENTS.GAME_FINISHED, event);
    await tasks.drain();

    expect(capture.find("background task failed")[0]).toEqual(
      expect.objectContaining({ task: "match pipeline", matchId: "m1", roomCode: "ROOM22" }),
    );
  });

  it("adds the game of a finished room the pipeline never got, once, with a warning", async () => {
    const { pipeline, pendingMatchAccessor, later, names, find } = setup({ finishedGames: [event] });

    const first = await pipeline.addFinishedRooms();
    const second = await pipeline.addFinishedRooms();
    await later(0);

    expect([first, second]).toEqual([1, 0]);
    expect(find("finished games added to the match pipeline late")).toEqual([
      expect.objectContaining({ level: 40, added: 1 }),
    ]);
    expect((await pendingMatchAccessor.get("m1")).status).toBe("done");
    expect(names()[0]).toBe("record");
  });

  it("says nothing about runs that changed nothing", () => {
    const { logger, entries } = captureLogger();

    logPipelineOutcome(logger, { matchId: "m1", status: "done", ran: [] });
    logPipelineOutcome(logger, { matchId: "m1", status: "busy" });
    logPipelineOutcome(logger, { matchId: "m1", status: "failed" });

    expect(entries).toEqual([]);
  });
});

describe("guest rows on the boards and guest sessions (ADR-060)", () => {
  it("end a guest's rows no later than the session that could still move them to an account", () => {
    expect(GUEST_ROW_LIFETIME_MS).toBeLessThanOrEqual(SESSION_TTL_SECONDS * 1000);
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
  const idleDeletions = () => ({ sweepDue: vi.fn(async () => ({ completed: [], failed: [] })) });

  const noRooms = async () => ({ waiting: 0, playing: 0, finished: 0 });
  const noConnections = () => ({ connections: 0, players: 0 });

  const idlePipeline = () => ({ runDue: vi.fn(), addFinishedRooms: vi.fn(async () => 0) });

  function setup(
    roomComponent,
    playerTransferComponent = idleTransfers(),
    connections = noConnections,
    botDriver = { resume: vi.fn(async () => {}) },
    matchPipeline = idlePipeline(),
    playerDataComponent = idleDeletions(),
  ) {
    vi.useFakeTimers();
    const capture = captureLogger();
    const housekeeping = startHousekeeping({
      roomComponent: { countRooms: noRooms, ...roomComponent },
      playerTransferComponent,
      matchPipeline,
      playerDataComponent,
      connections,
      botDriver,
      logger: capture.logger,
      now: () => 42,
    });
    return {
      housekeeping,
      playerTransferComponent,
      playerDataComponent,
      botDriver,
      matchPipeline,
      ...capture,
    };
  }

  it("sweeps account deletions again every minute and logs each one by player id (CC-035)", async () => {
    const roomComponent = { sweepExpired: vi.fn(), expireDue: vi.fn() };
    const deletions = {
      sweepDue: vi.fn(async () => ({
        completed: ["user_done"],
        failed: [{ playerId: "user_stuck", error: new Error("still down") }],
      })),
    };
    const { housekeeping, find } = setup(
      roomComponent,
      idleTransfers(),
      noConnections,
      undefined,
      undefined,
      deletions,
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(deletions.sweepDue).toHaveBeenCalledWith({ now: 42 });
    expect(find("account deletion swept again")[0].playerId).toBe("user_done");
    expect(find("account deletion sweep failed")[0]).toEqual(
      expect.objectContaining({
        playerId: "user_stuck",
        err: expect.objectContaining({ message: "still down" }),
      }),
    );
    housekeeping.stop();
  });

  it("lets computer players plan again for every room at each room sweep, and logs a failing run (CC-138)", async () => {
    const roomComponent = { sweepExpired: vi.fn(), expireDue: vi.fn() };
    const botDriver = {
      resume: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("database down")),
    };
    const { housekeeping, find } = setup(roomComponent, idleTransfers(), noConnections, botDriver);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(botDriver.resume).toHaveBeenCalledTimes(2);
    expect(find("planning for computer players failed")).toHaveLength(1);
    housekeeping.stop();
  });

  it("runs the match pipeline's due games every 5 seconds and adds lost finished games every minute (CC-111)", async () => {
    const roomComponent = { sweepExpired: vi.fn(), expireDue: vi.fn() };
    const { housekeeping, matchPipeline } = setup(roomComponent);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(matchPipeline.runDue).toHaveBeenCalledTimes(12);
    expect(matchPipeline.addFinishedRooms).toHaveBeenCalledOnce();
    housekeeping.stop();
  });

  it("logs a failure of the match pipeline's checks and keeps going (CC-111)", async () => {
    const roomComponent = { sweepExpired: vi.fn(), expireDue: vi.fn() };
    const matchPipeline = {
      runDue: vi.fn(() => {
        throw new Error("boom");
      }),
      addFinishedRooms: vi.fn(async () => Promise.reject(new Error("db down"))),
    };
    const { housekeeping, find } = setup(
      roomComponent,
      idleTransfers(),
      noConnections,
      undefined,
      matchPipeline,
    );

    await vi.advanceTimersByTimeAsync(120_000);

    expect(find("running the match pipeline failed")).toHaveLength(24);
    expect(find("adding finished games to the match pipeline failed")).toHaveLength(2);
    housekeeping.stop();
  });

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
    const { housekeeping, playerTransferComponent, botDriver } = setup(roomComponent);

    housekeeping.stop();
    vi.advanceTimersByTime(120_000);

    expect(botDriver.resume).not.toHaveBeenCalled();
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

  it("logs a gauge of open rooms per status, connections and players every minute (CC-107)", async () => {
    const roomComponent = {
      sweepExpired: vi.fn(),
      expireDue: vi.fn(),
      countRooms: vi.fn(async () => ({ waiting: 3, playing: 2, finished: 1 })),
    };
    const { housekeeping, find } = setup(roomComponent, idleTransfers(), () => ({
      connections: 7,
      players: 5,
    }));

    await vi.advanceTimersByTimeAsync(59_999);
    expect(find("room gauge")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(find("room gauge")).toEqual([
      expect.objectContaining({
        rooms: { waiting: 3, playing: 2, finished: 1, open: 6 },
        connections: 7,
        players: 5,
      }),
    ]);
    housekeeping.stop();
  });

  it("logs a failing gauge and keeps going", async () => {
    const roomComponent = {
      sweepExpired: vi.fn(),
      expireDue: vi.fn(),
      countRooms: vi.fn().mockRejectedValue(new Error("database down")),
    };
    const { housekeeping, find } = setup(roomComponent);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(find("reading the room gauge failed")).toHaveLength(2);
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

describe("reportOldEmailSpellings (CC-245)", () => {
  it("logs one line with only the two counts, never an email", async () => {
    const { logger, entries } = captureLogger();

    const counts = await reportOldEmailSpellings({
      accountAccessor: { loadEmailAliases: async () => 2 },
      legacyUserAccessor: { loadEmailAliases: async () => 0 },
      logger,
    });

    expect(counts).toEqual({ accounts: 2, legacyUsers: 0 });
    expect(entries).toEqual([
      expect.objectContaining({
        level: 30,
        accounts: 2,
        legacyUsers: 0,
        msg: "accounts with non-normal email: 2, legacy users with non-normal email: 0",
      }),
    ]);
  });
});

describe("roomErasure (CC-035)", () => {
  it("hands every room of a deleted player to a new stand-in each, and tells the rooms that changed", async () => {
    const room = { code: "ROOM22" };
    const roomComponent = { erasePlayer: vi.fn(async () => [room]) };
    const domainEvents = new EventEmitter();
    const updated = [];
    domainEvents.on(ROOM_EVENTS.UPDATED, (event) => updated.push(event));
    const uuids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
    const participant = roomErasure({ roomComponent, domainEvents, newUuid: () => uuids.shift() });

    const result = await participant.erasePlayer({ playerId: "user_x", now: 7 });

    expect(participant.name).toBe("rooms");
    expect(result).toEqual({ erased: { rooms: 1 } });
    expect(updated).toEqual([{ room }]);
    const { standIn } = roomComponent.erasePlayer.mock.calls[0][0];
    expect(standIn().id).toBe("deleted_00000000-0000-4000-8000-000000000001");
    expect(standIn().id).toBe("deleted_00000000-0000-4000-8000-000000000002");
    expect(roomComponent.erasePlayer).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: "user_x", now: 7 }),
    );
  });
});
