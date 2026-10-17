import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_IDS } from "@classicade/shared";
import { botRooms, PERSON } from "../../testing/botRooms.js";
import { captureLogger } from "../../testing/captureLogger.js";
import { GoneError } from "../../utils/errors.js";
import { ROOM_EVENTS } from "../rooms/roomComponent.js";
import { createBotDriver, HUMAN_PAUSE_MS, pauseBetween } from "./botDriver.js";

const PAUSE = 500;
const ROCKY = "bot_rocky_easy";
const UNBEATABLE_PIP = "bot_pip_hard";

/**
 * Rooms with computer players and a driver that pauses `PAUSE` ms before each action. With `wired` every saved
 * change reaches the driver, as the composition root wires it. Without, the driver only knows what a test tells
 * it. `updates` are the room views the driver announced.
 */
function setup({ seed = 1, wrapRooms = (rooms) => rooms, delayMs = () => PAUSE, wired = true } = {}) {
  const late = {};
  const base = botRooms({ seed, onChange: (room) => wired && late.driver.watch(room) });
  const updates = [];
  const capture = captureLogger();
  const driver = createBotDriver({
    roomComponent: wrapRooms(base.rooms),
    roomAccessor: base.roomAccessor,
    botTurns: base.botTurns,
    events: { emit: (event, payload) => event === ROOM_EVENTS.UPDATED && updates.push(payload.room) },
    delayMs,
    logger: capture.logger,
    now: () => 5_000,
    retryMs: 100,
  });
  late.driver = driver;
  return { ...base, driver, updates, capture };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("botDriver", () => {
  it("plays the computer's move after the pause, through the room, and announces the new room", async () => {
    const { playComputer, driver, updates, rooms } = setup();
    const room = await playComputer({ gameId: GAME_IDS.RPS });

    driver.watch(room);
    await vi.advanceTimersByTimeAsync(PAUSE - 1);
    expect(updates).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(updates).toHaveLength(1);
    expect(updates[0].game.state.pending[ROCKY]).toBe(JSON.parse(room.game.seals[0].text).choice);
    expect((await rooms.getRoom(room.code)).game.log.at(-1)).toEqual(
      expect.objectContaining({ kind: "move", playerId: ROCKY, at: 5_000 }),
    );
  });

  it("does not start the pause again for a change that leaves the same thing to do", async () => {
    const { playComputer, driver, updates, rooms } = setup();
    const room = await playComputer({ gameId: GAME_IDS.RPS });
    driver.watch(room);
    await vi.advanceTimersByTimeAsync(PAUSE / 2);

    driver.watch(await rooms.playerDisconnected({ code: room.code, playerId: PERSON.id, now: 2 }));
    await vi.advanceTimersByTimeAsync(PAUSE / 2);

    expect(updates).toHaveLength(1);
  });

  it("drops its plan when the moment passed, and plans from the room as it is then", async () => {
    const { playComputer, driver, updates, rooms } = setup({ wired: false });
    const room = await playComputer({ gameId: GAME_IDS.RPS });
    driver.watch(room);

    // The person leaves before the computer moves: the game is over and there is nothing left to do.
    await rooms.leaveRoom({ code: room.code, playerId: PERSON.id, now: 2 });
    await vi.advanceTimersByTimeAsync(PAUSE);

    expect(updates).toEqual([]);
    expect((await rooms.getRoom(room.code)).game.log.filter((e) => e.playerId === ROCKY)).toEqual([]);
  });

  it("cancels its plan when a change leaves nothing to do", async () => {
    const { playComputer, driver, updates, rooms } = setup();
    const room = await playComputer({ gameId: GAME_IDS.RPS });
    driver.watch(room);

    const { room: over } = await rooms.leaveRoom({ code: room.code, playerId: PERSON.id, now: 2 });
    driver.watch(over);
    await vi.advanceTimersByTimeAsync(PAUSE * 4);

    expect(updates).toEqual([]);
  });

  it("never acts on a finished game, and accepts the rematch the person asks for", async () => {
    const { playComputer, driver, updates, rooms } = setup();
    const room = await playComputer({ gameId: GAME_IDS.RPS, options: { bestOf: 1 } });
    driver.watch(room);
    await vi.advanceTimersByTimeAsync(PAUSE);
    const rocky = updates.at(-1).game.state.pending[ROCKY];
    const beat = { rock: "paper", paper: "scissors", scissors: "rock" }[rocky];
    const over = await rooms.makeMove({
      code: room.code,
      playerId: PERSON.id,
      move: { choice: beat },
      now: 3,
    });
    expect(over.status).toBe("finished");
    await vi.advanceTimersByTimeAsync(PAUSE * 4);
    expect(updates).toHaveLength(1);

    await rooms.requestRematch({ code: room.code, playerId: PERSON.id, now: 4 });
    await vi.advanceTimersByTimeAsync(PAUSE);

    expect(updates).toHaveLength(2);
    expect(updates[1].status).toBe("playing");
    expect(updates[1].game.matchId).toBe("m2");
  });

  it("plays a whole game of Tic-Tac-Toe against the person to its end", async () => {
    const { playComputer, driver, updates, rooms, engines } = setup({ seed: 2 });
    const started = await playComputer({ gameId: GAME_IDS.TIC_TAC_TOE, level: "hard" });
    driver.watch(started);
    let room = started;
    for (let turn = 0; turn < 9 && room.status === "playing"; turn++) {
      if (engines.get(GAME_IDS.TIC_TAC_TOE).activePlayers(room.game.state).includes(UNBEATABLE_PIP)) {
        await vi.advanceTimersByTimeAsync(PAUSE);
        room = updates.at(-1);
      } else {
        const cell = room.game.state.board.indexOf("");
        room = await rooms.makeMove({ code: room.code, playerId: PERSON.id, move: { cell }, now: 10 + turn });
      }
    }

    expect(room.status).toBe("finished");
    // Unbeatable never loses.
    expect(room.result.winners).not.toContain(PERSON.id);
  });

  it("picks up after a restart: every stored room with something to do gets a plan", async () => {
    const { playComputer, driver, updates } = setup({ wired: false });
    await playComputer({ gameId: GAME_IDS.RPS });
    await playComputer({ gameId: GAME_IDS.RPS });

    await driver.resume();
    await vi.advanceTimersByTimeAsync(PAUSE);

    expect(updates.map((room) => room.code).sort()).toEqual(["ROOM22", "ROOM33"]);
  });

  it("stops quietly when the room has closed", async () => {
    const { playComputer, driver, updates, capture } = setup({
      wrapRooms: (rooms) => ({
        ...rooms,
        getRoom: async () => {
          throw new GoneError("This room has closed");
        },
      }),
    });
    driver.watch(await playComputer({ gameId: GAME_IDS.RPS }));

    await vi.advanceTimersByTimeAsync(PAUSE * 10);

    expect(updates).toEqual([]);
    expect(capture.entries).toEqual([]);
  });

  it("tries again after a failure, and reports one that keeps failing", async () => {
    let failures = 0;
    const { playComputer, driver, capture } = setup({
      wrapRooms: (rooms) => ({
        ...rooms,
        makeMove: async () => {
          failures += 1;
          throw new Error("database down");
        },
      }),
    });
    driver.watch(await playComputer({ gameId: GAME_IDS.RPS }));

    await vi.advanceTimersByTimeAsync(PAUSE + 100 + 100);

    expect(failures).toBe(3);
    expect(capture.entries.map((entry) => entry.msg)).toEqual([
      "computer player will try again",
      "computer player will try again",
      "computer player failed",
    ]);
  });

  it("does nothing once stopped", async () => {
    const { playComputer, driver, updates } = setup();
    const room = await playComputer({ gameId: GAME_IDS.RPS });
    driver.watch(room);

    driver.stop();
    driver.watch(room);
    await vi.advanceTimersByTimeAsync(PAUSE * 4);

    expect(updates).toEqual([]);
  });

  it("does nothing when a planned action fires after the driver stopped", async () => {
    const { playComputer, driver, updates } = setup({ delayMs: () => 0 });
    const room = await playComputer({ gameId: GAME_IDS.RPS });
    driver.watch(room);
    const cancelled = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {});

    driver.stop();
    await vi.advanceTimersByTimeAsync(10);
    cancelled.mockRestore();

    expect(updates).toEqual([]);
  });

  it("checks what it needs at construction", () => {
    const { rooms, roomAccessor, botTurns } = botRooms();
    const base = {
      roomComponent: rooms,
      roomAccessor,
      botTurns,
      events: { emit() {} },
      delayMs: () => 0,
      logger: captureLogger().logger,
    };

    expect(() => createBotDriver(base)).not.toThrow();
    for (const missing of ["roomComponent", "roomAccessor", "botTurns", "events", "delayMs", "logger"]) {
      expect(() => createBotDriver({ ...base, [missing]: undefined })).toThrow(TypeError);
    }
  });
});

describe("pauseBetween", () => {
  it("gives whole milliseconds from min to max", () => {
    expect(pauseBetween({ min: 400, max: 900, random: () => 0 })()).toBe(400);
    expect(pauseBetween({ min: 400, max: 900, random: () => 0.999_999 })()).toBe(900);
    expect(pauseBetween({ min: 0, max: 0 })()).toBe(0);
  });

  it("feels like thinking in production, and stays well inside the time to a first move", () => {
    expect(HUMAN_PAUSE_MS).toEqual({ min: 400, max: 900 });
    const pause = pauseBetween(HUMAN_PAUSE_MS);
    for (let i = 0; i < 50; i++) {
      expect(pause()).toBeGreaterThanOrEqual(400);
      expect(pause()).toBeLessThanOrEqual(900);
    }
  });

  it.each([
    { min: -1, max: 2 },
    { min: 5, max: 2 },
    { min: 0.5, max: 2 },
  ])("refuses %o", (range) => {
    expect(() => pauseBetween(range)).toThrow(RangeError);
  });
});
