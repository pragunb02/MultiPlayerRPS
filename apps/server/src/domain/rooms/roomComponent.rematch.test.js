import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../persistence/inMemoryRoomDao.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../utils/errors.js";
import { createRoomComponent, ROOM_EVENTS, ROOM_TTL_MS } from "./roomComponent.js";

const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const CAROL = Object.freeze({ kind: "guest", id: "guest_c", displayName: "Carol" });
const T0 = 1_000_000;

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
function finishedGame() {
  const ctx = setup();
  ctx.rooms.createRoom({ host: ALICE, gameId: "race", options: { target: 3 }, now: T0 });
  ctx.rooms.joinRoom({ code: ctx.code, player: BOB, now: T0 + 1 });
  ctx.rooms.makeMove({ code: ctx.code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
  ctx.rooms.makeMove({ code: ctx.code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 3 });
  return ctx;
}

describe("roomComponent rematch (CC-037)", () => {
  it("offers a rematch once a game is played out", () => {
    const { rooms, code } = finishedGame();

    const view = rooms.viewFor(rooms.getRoom(code), ALICE.id);

    expect(view.rematch).toEqual({ requestedBy: [], available: true });
    expect(view.series).toEqual({ games: 1, wins: { [ALICE.id]: 1 } });
  });

  it("records a request and keeps the finished room alive", () => {
    const { rooms, code } = finishedGame();

    const room = rooms.requestRematch({ code, playerId: BOB.id, now: T0 + ROOM_TTL_MS.finished - 1 });

    expect(room.status).toBe("finished");
    expect(room.rematch).toEqual({ requestedBy: [BOB.id], available: true });
    expect(rooms.sweepExpired({ now: T0 + ROOM_TTL_MS.finished + 10 })).toEqual([]);
  });

  it("withdraws a request when the same player asks again", () => {
    const { rooms, code } = finishedGame();
    rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 4 });

    const room = rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 5 });

    expect(room.rematch.requestedBy).toEqual([]);
  });

  it("starts a new game in the same room once everyone asked, with the seats reversed", () => {
    const { rooms, code, published } = finishedGame();
    rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 4 });

    const room = rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 5 });

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

  it("counts the series across rematches", () => {
    const { rooms, code } = finishedGame();
    rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 4 });
    rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 5 });
    rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 6 });

    const room = rooms.makeMove({ code, playerId: BOB.id, move: { add: 2 }, now: T0 + 7 });

    expect(rooms.viewFor(room, BOB.id)).toEqual(
      expect.objectContaining({
        status: "finished",
        rematch: { requestedBy: [], available: true },
        series: { games: 2, wins: { [ALICE.id]: 1, [BOB.id]: 1 } },
      }),
    );
  });

  it("is not offered after a forfeit", () => {
    const ctx = setup();
    ctx.rooms.createRoom({ host: ALICE, gameId: "race", options: { target: 3 }, now: T0 });
    ctx.rooms.joinRoom({ code: ctx.code, player: BOB, now: T0 + 1 });
    ctx.rooms.leaveRoom({ code: ctx.code, playerId: BOB.id, now: T0 + 2 });

    expect(ctx.rooms.viewFor(ctx.rooms.getRoom(ctx.code), ALICE.id).rematch).toEqual({
      requestedBy: [],
      available: false,
    });
    expect(() => ctx.rooms.requestRematch({ code: ctx.code, playerId: ALICE.id, now: T0 + 3 })).toThrow(
      ConflictError,
    );
  });

  it("ends when a player leaves the finished room, clearing the requests", () => {
    const { rooms, code } = finishedGame();
    rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 4 });

    const { room } = rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 5 });

    expect(room.rematch).toEqual({ requestedBy: [], available: false });
    expect(() => rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 6 })).toThrow(/opponent left/);
  });

  it("refuses a rematch before the game is over", () => {
    const { rooms, code } = setup();
    rooms.createRoom({ host: ALICE, gameId: "race", options: { target: 3 }, now: T0 });

    expect(() => rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 1 })).toThrow(ConflictError);
  });

  it("refuses someone without a seat", () => {
    const { rooms, code } = finishedGame();

    expect(() => rooms.requestRematch({ code, playerId: CAROL.id, now: T0 + 4 })).toThrow(ForbiddenError);
  });

  it("refuses an unknown room", () => {
    const { rooms } = setup();

    expect(() => rooms.requestRematch({ code: "NOPE22", playerId: ALICE.id, now: T0 })).toThrow(
      NotFoundError,
    );
  });

  it("has no rematch or series in a room that has not finished a game", () => {
    const { rooms } = setup();
    const room = rooms.createRoom({ host: ALICE, gameId: "race", options: { target: 3 }, now: T0 });

    const view = rooms.viewFor(room, ALICE.id);

    expect(view).not.toHaveProperty("rematch");
    expect(view).not.toHaveProperty("series");
  });

  it("keeps a guest's series wins when they sign in during the rematch", () => {
    const { rooms, code } = finishedGame();
    rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 4 });
    rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 5 });
    const account = { kind: "user", id: "user_a", displayName: "alice" };

    rooms.transferPlayer({ from: ALICE.id, to: account, now: T0 + 6 });

    expect(rooms.getRoom(code).series).toEqual({ games: 1, wins: { user_a: 1 } });
  });
});
