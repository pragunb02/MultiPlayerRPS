import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { ConflictError, ForbiddenError, GoneError, NotFoundError } from "../../utils/errors.js";
import { createRoomComponent, ROOM_EVENTS } from "./roomComponent.js";
import { ROOM_LIFETIMES } from "./roomLifetimes.js";

const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const CAROL = Object.freeze({ kind: "guest", id: "guest_c", displayName: "Carol" });
const T0 = 1_000_000;
// The game in finishedGame() ends at T0 + 3, and the rematch window counts from then.
const UNTIL = T0 + 3 + ROOM_LIFETIMES.rematchWindowMs;

/** Room component over the real accessor + in-memory DAO; match ids m1, m2, … */
function setup() {
  const published = [];
  let matchNumber = 0;
  const rooms = createRoomComponent({
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry([raceEngine]),
    events: { emit: (event, payload) => published.push({ event, payload }) },
    generateCode: () => "ROOM22",
    generateSeed: () => 42, // seed 42: the second seat moves first
    generateMatchId: () => `m${++matchNumber}`,
  });
  return { rooms, published, code: "ROOM22" };
}

/** Alice hosts, Bob joins and moves first (seed 42); Alice reaches 3 and wins. */
async function finishedGame() {
  const ctx = setup();
  await ctx.rooms.createRoom({ host: ALICE, gameId: "race", options: { target: 3 }, now: T0 });
  await ctx.rooms.joinRoom({ code: ctx.code, player: BOB, now: T0 + 1 });
  await ctx.rooms.makeMove({ code: ctx.code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
  await ctx.rooms.makeMove({ code: ctx.code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 3 });
  return ctx;
}

describe("roomComponent rematch (CC-037)", () => {
  it("offers a rematch once a game is played out", async () => {
    const { rooms, code } = await finishedGame();

    const view = rooms.viewFor(await rooms.getRoom(code), ALICE.id);

    expect(view.rematch).toEqual({ requestedBy: [], available: true, until: UNTIL });
    expect(view.series).toEqual({ games: 1, wins: { [ALICE.id]: 1 } });
  });

  it("records a request without moving the end of the rematch window", async () => {
    const { rooms, code } = await finishedGame();

    const room = await rooms.requestRematch({ code, playerId: BOB.id, now: UNTIL - 1 });

    expect(room.status).toBe("finished");
    expect(rooms.viewFor(room, ALICE.id).rematch).toEqual({
      requestedBy: [BOB.id],
      available: true,
      until: UNTIL,
    });
    expect(await rooms.sweepExpired({ now: UNTIL })).toEqual([code]);
  });

  it("withdraws a request when the same player asks again", async () => {
    const { rooms, code } = await finishedGame();
    await rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 4 });

    const room = await rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 5 });

    expect(room.rematch.requestedBy).toEqual([]);
  });

  it("starts a new game in the same room once everyone asked, with the seats reversed", async () => {
    const { rooms, code, published } = await finishedGame();
    await rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 4 });

    const room = await rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 5 });

    expect(room.code).toBe(code);
    expect(room.status).toBe("playing");
    expect(room.options).toEqual({ target: 3 });
    expect(room.seats.map((seat) => seat.playerId)).toEqual([BOB.id, ALICE.id]);
    expect(room.game).toEqual({
      matchId: "m2",
      seed: 42,
      startedAt: T0 + 5,
      state: expect.any(Object),
      log: [],
    });
    expect(room.result).toBeUndefined();
    expect(room.rematch).toBeUndefined();
    expect(room.series).toEqual({ games: 1, wins: { [ALICE.id]: 1 } });
    // Seed 42 lets the second seat start: now Alice, last game Bob — the first move alternates.
    expect(rooms.viewFor(room, ALICE.id).game.activePlayers).toEqual([ALICE.id]);
    expect(published.filter((p) => p.event === ROOM_EVENTS.GAME_FINISHED)).toHaveLength(1);
  });

  it("counts the series across rematches", async () => {
    const { rooms, code } = await finishedGame();
    await rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 4 });
    await rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 5 });
    await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 6 });

    const room = await rooms.makeMove({ code, playerId: BOB.id, move: { add: 2 }, now: T0 + 7 });

    expect(rooms.viewFor(room, BOB.id)).toEqual(
      expect.objectContaining({
        status: "finished",
        rematch: { requestedBy: [], available: true, until: T0 + 7 + ROOM_LIFETIMES.rematchWindowMs },
        series: { games: 2, wins: { [ALICE.id]: 1, [BOB.id]: 1 } },
      }),
    );
  });

  it("is not offered after a forfeit", async () => {
    const ctx = setup();
    await ctx.rooms.createRoom({ host: ALICE, gameId: "race", options: { target: 3 }, now: T0 });
    await ctx.rooms.joinRoom({ code: ctx.code, player: BOB, now: T0 + 1 });
    await ctx.rooms.leaveRoom({ code: ctx.code, playerId: BOB.id, now: T0 + 2 });

    expect(ctx.rooms.viewFor(await ctx.rooms.getRoom(ctx.code), ALICE.id).rematch).toEqual({
      requestedBy: [],
      available: false,
      until: T0 + 2 + ROOM_LIFETIMES.rematchWindowMs,
    });
    await expect(
      ctx.rooms.requestRematch({ code: ctx.code, playerId: ALICE.id, now: T0 + 3 }),
    ).rejects.toThrow(ConflictError);
  });

  it("ends when a player leaves the finished room, clearing the requests", async () => {
    const { rooms, code } = await finishedGame();
    await rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 4 });

    const { room } = await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 5 });

    expect(room.rematch).toEqual({ requestedBy: [], available: false });
    await expect(rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 6 })).rejects.toThrow(
      /opponent left/,
    );
  });

  it("refuses a rematch before the game is over", async () => {
    const { rooms, code } = setup();
    await rooms.createRoom({ host: ALICE, gameId: "race", options: { target: 3 }, now: T0 });

    await expect(rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 1 })).rejects.toThrow(
      ConflictError,
    );
  });

  it("refuses someone without a seat", async () => {
    const { rooms, code } = await finishedGame();

    await expect(rooms.requestRematch({ code, playerId: CAROL.id, now: T0 + 4 })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("refuses an unknown room", async () => {
    const { rooms } = setup();

    await expect(rooms.requestRematch({ code: "NOPE22", playerId: ALICE.id, now: T0 })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("has no rematch or series in a room that has not finished a game", async () => {
    const { rooms } = setup();
    const room = await rooms.createRoom({ host: ALICE, gameId: "race", options: { target: 3 }, now: T0 });

    const view = rooms.viewFor(room, ALICE.id);

    expect(view).not.toHaveProperty("rematch");
    expect(view).not.toHaveProperty("series");
  });

  it("keeps a guest's series wins when they sign in during the rematch", async () => {
    const { rooms, code } = await finishedGame();
    await rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 4 });
    await rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 5 });
    const account = { kind: "user", id: "user_a", displayName: "alice" };

    await rooms.transferPlayer({ from: ALICE.id, to: account, now: T0 + 6 });

    expect((await rooms.getRoom(code)).series).toEqual({ games: 1, wins: { user_a: 1 } });
  });

  it("cannot be asked for once the rematch window has ended, and says why the room closed", async () => {
    const { rooms, code, published } = await finishedGame();
    await rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 4 });

    const error = await rooms.requestRematch({ code, playerId: ALICE.id, now: UNTIL }).catch((err) => err);

    expect(error).toBeInstanceOf(GoneError);
    expect(error.details).toEqual({ reason: "rematch-window-ended", gameId: "race", closedAt: UNTIL });
    expect(published.at(-1)).toEqual({
      event: ROOM_EVENTS.CLOSED,
      payload: { code, reason: "rematch-window-ended" },
    });
  });

  it("can still be accepted a moment before the window ends, after a long time on the result screen", async () => {
    const { rooms, code } = await finishedGame();
    await rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 4 });

    const room = await rooms.requestRematch({ code, playerId: ALICE.id, now: UNTIL - 1 });

    expect(room.status).toBe("playing");
    expect(room).not.toHaveProperty("finishedAt");
  });
});
