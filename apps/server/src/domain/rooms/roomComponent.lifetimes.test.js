import { describe, expect, it } from "vitest";
import { createEngineRegistry, defineEngine } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { GoneError } from "../../utils/errors.js";
import { createRoomComponent, ROOM_EVENTS } from "./roomComponent.js";
import { ROOM_LIFETIMES, roomLifetimes } from "./roomLifetimes.js";

// Every boundary of every room lifetime (CC-101), with the clock passed in so each test can say exactly when.
const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
const MINUTE = 60_000;
const { waitingMs, rematchWindowMs, awayMs, idleGameMs, closedRecordMs } = ROOM_LIFETIMES;

function setup({ lifetimes, wrap = (a) => a } = {}) {
  const published = [];
  const accessor = createRoomAccessor({ roomDao: createInMemoryRoomDao() });
  const rooms = createRoomComponent({
    roomAccessor: wrap(accessor),
    engines: createEngineRegistry([raceEngine]),
    events: { emit: (event, payload) => published.push({ event, payload }) },
    ...(lifetimes && { lifetimes }),
    generateCode: () => "ROOM22",
    generateSeed: () => 42, // the second seat (Bob) moves first
  });
  const closedEvents = () => published.filter((p) => p.event === ROOM_EVENTS.CLOSED).map((p) => p.payload);
  return { rooms, accessor, closedEvents, code: "ROOM22" };
}

const waitingRoom = async (ctx, now = T0) =>
  ctx.rooms.createRoom({ host: ALICE, gameId: "race", options: { target: 3 }, now });

async function runningGame(ctx, now = T0) {
  await waitingRoom(ctx, now);
  return ctx.rooms.joinRoom({ code: ctx.code, player: BOB, now });
}

/** Bob moves 1, Alice moves 2 and reaches 3: the game ends at `endedAt`. */
async function finishedGame(ctx, endedAt = T0 + 2) {
  await runningGame(ctx);
  await ctx.rooms.makeMove({ code: ctx.code, playerId: BOB.id, move: { add: 1 }, now: T0 + 1 });
  return ctx.rooms.makeMove({ code: ctx.code, playerId: ALICE.id, move: { add: 2 }, now: endedAt });
}

describe("room lifetimes in the room component (CC-101)", () => {
  describe("a waiting room", () => {
    it("stays open until a moment before its time is up", async () => {
      const ctx = setup();
      await waitingRoom(ctx);

      expect(await ctx.rooms.sweepExpired({ now: T0 + waitingMs - 1 })).toEqual([]);
    });

    it("closes as expired when its time is up", async () => {
      const ctx = setup();
      await waitingRoom(ctx);

      expect(await ctx.rooms.sweepExpired({ now: T0 + waitingMs })).toEqual([ctx.code]);
      expect(ctx.closedEvents()).toEqual([{ code: ctx.code, reason: "expired" }]);
    });

    it("counts from the last thing that happened, not from when it was made", async () => {
      const ctx = setup();
      await waitingRoom(ctx);
      await ctx.rooms.playerDisconnected({ code: ctx.code, playerId: ALICE.id, now: T0 + 10 * MINUTE });

      expect(await ctx.rooms.sweepExpired({ now: T0 + waitingMs })).toEqual([]);
      expect(await ctx.rooms.sweepExpired({ now: T0 + 10 * MINUTE + waitingMs })).toEqual([ctx.code]);
    });
  });

  describe("a finished room and its rematch window", () => {
    it("still finds the room for a rematch asked for after 15 minutes on the result screen (the bug)", async () => {
      // Before CC-101 a finished room closed 10 minutes after the game, so this request met "Room not found".
      const ctx = setup();
      await finishedGame(ctx, T0);
      await ctx.rooms.sweepExpired({ now: T0 + 15 * MINUTE });

      const room = await ctx.rooms.requestRematch({
        code: ctx.code,
        playerId: BOB.id,
        now: T0 + 15 * MINUTE,
      });

      expect(room.rematch.requestedBy).toEqual([BOB.id]);
    });

    it("tells the players when the window ends", async () => {
      const ctx = setup();
      const room = await finishedGame(ctx, T0);

      expect(ctx.rooms.viewFor(room, ALICE.id).rematch.until).toBe(T0 + rematchWindowMs);
    });

    it("stays open until a moment before the window ends, then closes saying why", async () => {
      const ctx = setup();
      await finishedGame(ctx, T0);

      expect(await ctx.rooms.sweepExpired({ now: T0 + rematchWindowMs - 1 })).toEqual([]);
      expect(await ctx.rooms.sweepExpired({ now: T0 + rematchWindowMs })).toEqual([ctx.code]);
      expect(ctx.closedEvents()).toEqual([{ code: ctx.code, reason: "rematch-window-ended" }]);
    });

    it("closes the moment someone comes back after the window ended, even before the sweep runs", async () => {
      const ctx = setup();
      await finishedGame(ctx, T0);

      const error = await ctx.rooms
        .joinRoom({ code: ctx.code, player: BOB, now: T0 + rematchWindowMs })
        .catch((err) => err);

      expect(error).toBeInstanceOf(GoneError);
      expect(error.details.reason).toBe("rematch-window-ended");
    });

    it("says why it closed when the sweep closes it while someone is coming back (CC-204)", async () => {
      // The sweep closes the room right after this player's request has read it, before it closes it itself.
      let sweepNow = false;
      const ctx = setup({
        wrap: (accessor) => ({
          ...accessor,
          async getByCode(code) {
            const room = await accessor.getByCode(code);
            if (sweepNow) {
              sweepNow = false;
              await accessor.close({ room, reason: "rematch-window-ended", closedAt: T0 + rematchWindowMs });
            }
            return room;
          },
        }),
      });
      await finishedGame(ctx, T0);
      sweepNow = true;

      const error = await ctx.rooms
        .joinRoom({ code: ctx.code, player: BOB, now: T0 + rematchWindowMs })
        .catch((err) => err);

      expect(error).toBeInstanceOf(GoneError);
      expect(error.details.reason).toBe("rematch-window-ended");
    });

    it("reads the room again when it changed before it could be closed, then closes it", async () => {
      // Someone saves the room right after this request has read it, so closing the version it read fails.
      let changeNow = false;
      const ctx = setup({
        wrap: (accessor) => ({
          ...accessor,
          async getByCode(code) {
            const room = await accessor.getByCode(code);
            if (changeNow) {
              changeNow = false;
              await accessor.save({
                room: { ...room, seats: room.seats.map((seat) => ({ ...seat, connected: false })) },
                previous: room,
              });
            }
            return room;
          },
        }),
      });
      await finishedGame(ctx, T0);
      changeNow = true;

      const error = await ctx.rooms
        .joinRoom({ code: ctx.code, player: BOB, now: T0 + rematchWindowMs })
        .catch((err) => err);

      expect(error).toBeInstanceOf(GoneError);
      expect(ctx.closedEvents()).toEqual([{ code: ctx.code, reason: "rematch-window-ended" }]);
    });

    it("can be shortened for browser tests through the lifetimes given", async () => {
      const ctx = setup({ lifetimes: roomLifetimes({ rematchWindowMs: 5_000 }) });
      await finishedGame(ctx, T0);

      expect(await ctx.rooms.sweepExpired({ now: T0 + 5_000 })).toEqual([ctx.code]);
    });
  });

  describe("a game whose players are away", () => {
    it("is still there when a phone comes back from the lock screen half an hour later (the bug)", async () => {
      // Before CC-101 a game whose seats were all disconnected closed after 5 minutes.
      const ctx = setup();
      await runningGame(ctx);
      await ctx.rooms.playerDisconnected({ code: ctx.code, playerId: ALICE.id, now: T0 + 1 });
      await ctx.rooms.playerDisconnected({ code: ctx.code, playerId: BOB.id, now: T0 + 2 });
      await ctx.rooms.sweepExpired({ now: T0 + 30 * MINUTE });

      const room = await ctx.rooms.joinRoom({ code: ctx.code, player: BOB, now: T0 + 30 * MINUTE });

      expect(room.status).toBe("playing");
    });

    it("closes as abandoned once everyone has been away for the whole time", async () => {
      const ctx = setup();
      await runningGame(ctx);
      await ctx.rooms.playerDisconnected({ code: ctx.code, playerId: ALICE.id, now: T0 + 1 });
      await ctx.rooms.playerDisconnected({ code: ctx.code, playerId: BOB.id, now: T0 + 2 });

      expect(await ctx.rooms.sweepExpired({ now: T0 + 2 + awayMs - 1 })).toEqual([]);
      expect(await ctx.rooms.sweepExpired({ now: T0 + 2 + awayMs })).toEqual([ctx.code]);
      expect(ctx.closedEvents()).toEqual([{ code: ctx.code, reason: "abandoned" }]);
    });

    it("is kept a whole day while one player is still connected, and closes after that", async () => {
      const ctx = setup();
      await runningGame(ctx);
      await ctx.rooms.playerDisconnected({ code: ctx.code, playerId: BOB.id, now: T0 + 1 });

      expect(await ctx.rooms.sweepExpired({ now: T0 + 1 + idleGameMs - 1 })).toEqual([]);
      expect(await ctx.rooms.sweepExpired({ now: T0 + 1 + idleGameMs })).toEqual([ctx.code]);
    });
  });

  describe("records of closed rooms", () => {
    it("are kept for a day, then forgotten, after which the code simply does not exist", async () => {
      const ctx = setup();
      await waitingRoom(ctx);
      await ctx.rooms.sweepExpired({ now: T0 + waitingMs });

      await ctx.rooms.sweepExpired({ now: T0 + waitingMs + closedRecordMs });
      expect(await ctx.accessor.wasClosed(ctx.code)).toBe(true);
      await ctx.rooms.sweepExpired({ now: T0 + waitingMs + closedRecordMs + 1 });

      expect(await ctx.accessor.wasClosed(ctx.code)).toBe(false);
    });
  });

  describe("the sweep", () => {
    it("leaves a room alone that changed after it was listed, and looks again next time", async () => {
      let stale = [];
      const ctx = setup({ wrap: (accessor) => ({ ...accessor, listExpired: async () => stale }) });
      stale = [await waitingRoom(ctx)];
      await ctx.rooms.playerDisconnected({ code: ctx.code, playerId: ALICE.id, now: T0 + 1 });

      expect(await ctx.rooms.sweepExpired({ now: T0 + waitingMs })).toEqual([]);
      expect(await ctx.accessor.exists(ctx.code)).toBe(true);
    });

    it("does not close a listed room whose lifetime has moved on", async () => {
      let stale = [];
      const ctx = setup({ wrap: (accessor) => ({ ...accessor, listExpired: async () => stale }) });
      stale = [await waitingRoom(ctx)];

      expect(await ctx.rooms.sweepExpired({ now: T0 + 1 })).toEqual([]);
    });

    it("reports a storage failure instead of hiding it", async () => {
      const failure = new Error("disk on fire");
      const ctx = setup({
        wrap: (accessor) => ({
          ...accessor,
          listExpired: async () => [{ code: "ROOM22", status: "waiting", lastActivityAt: T0, seats: [] }],
          close: async () => {
            throw failure;
          },
        }),
      });

      await expect(ctx.rooms.sweepExpired({ now: T0 + waitingMs })).rejects.toThrow(failure);
    });
  });

  describe("deadlines listed a moment ago", () => {
    const timedEngine = defineEngine({
      ...raceEngine,
      id: "timed",
      init: (setup) => ({ ...raceEngine.init(setup), deadline: T0 + 1_000 }),
      deadline: (state) => (state.winner === "" ? state.deadline : 0),
      expire: (state) => ({ ...state, winner: state.players[0] }),
    });

    it("leave a room alone whose game ended in the meantime", async () => {
      let stale = [];
      const rooms = createRoomComponent({
        roomAccessor: ((accessor) => ({ ...accessor, listDue: async () => stale }))(
          createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
        ),
        engines: createEngineRegistry([timedEngine]),
        events: { emit() {} },
        generateCode: () => "ROOM22",
      });
      await rooms.createRoom({ host: ALICE, gameId: "timed", options: { target: 3 }, now: T0 });
      stale = [await rooms.joinRoom({ code: "ROOM22", player: BOB, now: T0 })];
      await rooms.leaveRoom({ code: "ROOM22", playerId: BOB.id, now: T0 + 1 });

      expect(await rooms.expireDue({ now: T0 + 1_000 })).toEqual([]);
    });

    it("leave a room alone whose deadline moved later in the meantime", async () => {
      const rooms = createRoomComponent({
        roomAccessor: ((accessor) => ({ ...accessor, listDue: accessor.listAll }))(
          createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
        ),
        engines: createEngineRegistry([timedEngine]),
        events: { emit() {} },
        generateCode: () => "ROOM22",
      });
      await rooms.createRoom({ host: ALICE, gameId: "timed", options: { target: 3 }, now: T0 });
      await rooms.joinRoom({ code: "ROOM22", player: BOB, now: T0 });

      expect(await rooms.expireDue({ now: T0 + 999 })).toEqual([]);
    });
  });
});
