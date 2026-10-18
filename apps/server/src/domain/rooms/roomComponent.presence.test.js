import { describe, expect, it } from "vitest";
import { createEngineRegistry, defineEngine, ENGINES } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { ConflictError, ForbiddenError } from "../../utils/errors.js";
import { createRoomComponent, ROOM_EVENTS } from "./roomComponent.js";
import { ROOM_LIFETIMES } from "./roomLifetimes.js";

// Presence (CC-158, CC-207) and the rules that follow from it (CC-036): away and offline seats, a finished room
// that lets go of a player who stays away, claiming the win from an opponent who never came back, idle limits and
// the first move abort.

const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const T0 = 1_000_000;
const { awayReleaseMs, reconnectGraceMs, firstMoveMs } = ROOM_LIFETIMES;
// The race with a thirty second limit per move, like the real games have.
const timedRace = defineEngine({ ...raceEngine, id: "timed-race", turnLimitMs: 30_000 });
const rpsEngine = ENGINES.find((engine) => engine.id === "rps");

function setup() {
  const published = [];
  let matchNumber = 0;
  const rooms = createRoomComponent({
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry([raceEngine, timedRace, rpsEngine]),
    events: { emit: (event, payload) => published.push({ event, payload }) },
    generateCode: () => "ROOM22",
    generateSeed: () => 42, // the second seat moves first in the race
    generateMatchId: () => `m${++matchNumber}`,
  });
  return { rooms, published, code: "ROOM22" };
}

async function started(gameId = "race", options = { target: 3 }) {
  const ctx = setup();
  await ctx.rooms.createRoom({ network: "net-a", host: ALICE, gameId, options, now: T0 });
  await ctx.rooms.joinRoom({ code: ctx.code, player: BOB, now: T0 + 1 });
  return ctx;
}

/** Bob moves first, Alice reaches 3 and wins at T0 + 3. */
async function finished() {
  const ctx = await started();
  await ctx.rooms.makeMove({ code: ctx.code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
  await ctx.rooms.makeMove({ code: ctx.code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 3 });
  return ctx;
}

const seatView = (rooms, room, playerId) =>
  rooms.viewFor(room, playerId).seats.find((seat) => seat.playerId === playerId);
const updates = (published) => published.filter(({ event }) => event === ROOM_EVENTS.UPDATED);

describe("roomComponent presence (CC-158, CC-207)", () => {
  it("shows a player who left the room's page as away, and here again once they come back", async () => {
    const { rooms, code } = await started();

    const away = await rooms.playerAway({ code, playerId: ALICE.id, now: T0 + 5 });
    expect(seatView(rooms, away, ALICE.id)).toEqual({
      playerId: ALICE.id,
      displayName: "Alice",
      connected: false,
      presence: "away",
      since: T0 + 5,
      graceUntil: 0,
    });

    const back = await rooms.joinRoom({ code, player: ALICE, now: T0 + 6 });
    expect(seatView(rooms, back, ALICE.id)).toEqual(
      expect.objectContaining({ presence: "here", since: T0 + 6 }),
    );
  });

  it("gives an offline player in a game still on a grace period, and none once the game is over", async () => {
    const { rooms, code } = await started();

    const offline = await rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 5 });

    expect(seatView(rooms, offline, BOB.id)).toEqual(
      expect.objectContaining({
        connected: false,
        presence: "offline",
        graceUntil: T0 + 5 + reconnectGraceMs,
      }),
    );
    const { room } = await rooms.leaveRoom({ code, playerId: ALICE.id, now: T0 + 6 });
    expect(seatView(rooms, room, BOB.id).graceUntil).toBe(0);
  });

  it("changes nothing when a player is already where they are said to be", async () => {
    const { rooms, code } = await started();
    const before = await rooms.playerAway({ code, playerId: ALICE.id, now: T0 + 5 });

    const again = await rooms.playerAway({ code, playerId: ALICE.id, now: T0 + 9 });

    expect(again).toEqual(before);
    expect(again.version).toBe(before.version);
  });

  it("refuses presence changes for someone without a seat", async () => {
    const { rooms, code } = await started();

    await expect(rooms.playerAway({ code, playerId: "guest_x", now: T0 + 5 })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("makes an offline player away in every room once they connect again, and tells the rooms", async () => {
    const { rooms, code, published } = await started();
    await rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 5 });

    const changed = await rooms.playerOnline({ playerId: BOB.id, now: T0 + 6 });

    expect(changed.map((room) => room.code)).toEqual([code]);
    expect(seatView(rooms, changed[0], BOB.id)).toEqual(
      expect.objectContaining({ presence: "away", since: T0 + 6 }),
    );
    expect(updates(published).at(-1).payload.room).toBe(changed[0]);
    expect(await rooms.playerOnline({ playerId: BOB.id, now: T0 + 7 })).toEqual([]);
    expect(await rooms.playerOnline({ playerId: ALICE.id, now: T0 + 7 })).toEqual([]);
  });

  it("makes an away player offline in every room once their last tab closes", async () => {
    const { rooms, code } = await started();
    await rooms.playerAway({ code, playerId: BOB.id, now: T0 + 5 });

    const changed = await rooms.playerOffline({ playerId: BOB.id, now: T0 + 6 });

    expect(seatView(rooms, changed[0], BOB.id).presence).toBe("offline");
    expect(await rooms.playerOffline({ playerId: ALICE.id, now: T0 + 7 })).toEqual([]);
  });

  it("shows everyone as offline after a restart, without moving the room's last activity", async () => {
    const { rooms, code } = await started();
    await rooms.playerAway({ code, playerId: ALICE.id, now: T0 + 5 });
    await rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 6 });
    expect(await rooms.markEveryoneAway({ now: T0 + 10 })).toEqual([code]);

    const room = await rooms.getRoom(code);
    expect(room.seats.map((seat) => seatView(rooms, room, seat.playerId))).toEqual([
      expect.objectContaining({ presence: "offline", since: T0 + 10 }),
      expect.objectContaining({ presence: "offline", since: T0 + 6 }),
    ]);
    expect(room.lastActivityAt).toBe(T0 + 6);
    expect(await rooms.markEveryoneAway({ now: T0 + 11 })).toEqual([]);
  });

  it("reads seats stored before presence existed by whether they are connected", async () => {
    const { rooms, code } = await started();
    const stored = await rooms.getRoom(code);
    const old = {
      ...stored,
      seats: stored.seats.map(({ playerId, displayName }, index) => ({
        playerId,
        displayName,
        connected: index === 0,
      })),
    };

    expect(rooms.viewFor(old, ALICE.id).seats.map(({ presence, since }) => [presence, since])).toEqual([
      ["here", stored.lastActivityAt],
      ["offline", stored.lastActivityAt],
    ]);
  });
});

describe("roomComponent finished rooms a player stays away from (CC-207)", () => {
  it("gives up the seat of a player away for two minutes, so the opponent knows there is no rematch", async () => {
    const { rooms, code } = await finished();
    await rooms.playerAway({ code, playerId: ALICE.id, now: T0 + 10 });
    expect((await rooms.getRoom(code)).dueAt).toBe(T0 + 10 + awayReleaseMs);

    expect(await rooms.expireDue({ now: T0 + 10 + awayReleaseMs - 1 })).toEqual([]);
    expect(await rooms.expireDue({ now: T0 + 10 + awayReleaseMs })).toEqual([code]);

    const room = await rooms.getRoom(code);
    expect(room.seats.map((seat) => seat.playerId)).toEqual([BOB.id]);
    expect(rooms.viewFor(room, BOB.id).rematch).toEqual(
      expect.objectContaining({ available: false, leftName: "Alice" }),
    );
  });

  it("counts from the end of the game for a player who was already away when it ended", async () => {
    const { rooms, code } = await started();
    await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
    await rooms.playerAway({ code, playerId: BOB.id, now: T0 + 3 });

    const room = await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 50 });

    expect(room.dueAt).toBe(T0 + 50 + awayReleaseMs);
  });

  it("keeps the seat of a player who came back in time", async () => {
    const { rooms, code } = await finished();
    await rooms.playerAway({ code, playerId: ALICE.id, now: T0 + 10 });
    await rooms.joinRoom({ code, player: ALICE, now: T0 + 20 });

    expect(await rooms.expireDue({ now: T0 + 10 + awayReleaseMs })).toEqual([]);
    expect((await rooms.getRoom(code)).seats).toHaveLength(2);
  });

  it("closes the room once both players stayed away", async () => {
    const { rooms, code, published } = await finished();
    await rooms.playerAway({ code, playerId: ALICE.id, now: T0 + 10 });
    await rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 10 });

    expect(await rooms.expireDue({ now: T0 + 10 + awayReleaseMs })).toEqual([]);

    expect(published.at(-1)).toEqual({ event: ROOM_EVENTS.CLOSED, payload: { code, reason: "empty" } });
  });
});

describe("roomComponent claiming the win from an opponent who stays offline (CC-036)", () => {
  it("lets the player still there claim the win once the grace period is over", async () => {
    const { rooms, code, published } = await started();
    await rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 5 });
    await expect(
      rooms.claimWin({ code, playerId: ALICE.id, now: T0 + 4 + reconnectGraceMs }),
    ).rejects.toThrow("Your opponent can still come back");

    const room = await rooms.claimWin({ code, playerId: ALICE.id, now: T0 + 5 + reconnectGraceMs });

    expect(room.status).toBe("finished");
    expect(room.result).toEqual({
      status: "finished",
      result: "win",
      winners: [ALICE.id],
      reason: "forfeit",
    });
    expect(room.game.log.at(-1)).toEqual({
      kind: "forfeit",
      playerId: BOB.id,
      at: T0 + 5 + reconnectGraceMs,
    });
    expect(room.rematch).toEqual({ available: false });
    expect(published.filter(({ event }) => event === ROOM_EVENTS.GAME_FINISHED)).toHaveLength(1);
  });

  it("refuses a claim against an opponent who is only away, after the game, and for yourself", async () => {
    const { rooms, code } = await started();
    await rooms.playerAway({ code, playerId: BOB.id, now: T0 + 5 });
    await expect(
      rooms.claimWin({ code, playerId: ALICE.id, now: T0 + 5 + reconnectGraceMs }),
    ).rejects.toThrow(ConflictError);
    await rooms.playerDisconnected({ code, playerId: ALICE.id, now: T0 + 6 });
    await expect(
      rooms.claimWin({ code, playerId: ALICE.id, now: T0 + 6 + reconnectGraceMs }),
    ).rejects.toThrow(ConflictError);
    await expect(rooms.claimWin({ code, playerId: "guest_x", now: T0 + 7 })).rejects.toThrow(ForbiddenError);

    const done = await finished();
    await expect(done.rooms.claimWin({ code: done.code, playerId: ALICE.id, now: T0 + 4 })).rejects.toThrow(
      "The game is not on",
    );
  });
});

describe("roomComponent idle limits (CC-036)", () => {
  it("aborts a game whose first player never made a first move, and records nothing", async () => {
    const { rooms, code, published } = await started();
    expect(rooms.viewFor(await rooms.getRoom(code), ALICE.id).game.turnEndsAt).toBe(T0 + 1 + firstMoveMs);

    expect(await rooms.expireDue({ now: T0 + 1 + firstMoveMs })).toEqual([code]);

    const room = await rooms.getRoom(code);
    expect(room.status).toBe("finished");
    expect(room.result).toEqual({ status: "finished", result: "aborted", winners: [], reason: "aborted" });
    expect(room.series).toBeUndefined();
    expect(room.rematch).toEqual({ available: true });
    expect(published.filter(({ event }) => event === ROOM_EVENTS.GAME_FINISHED)).toEqual([]);
    expect(rooms.viewFor(room, ALICE.id).game).toEqual(
      expect.objectContaining({ number: 1, turnEndsAt: 0, activePlayers: [] }),
    );
  });

  it("aborts when the second player never makes a first move, and the next game is game 2", async () => {
    const { rooms, code } = await started();
    await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
    await rooms.expireDue({ now: T0 + 2 + firstMoveMs });
    await rooms.askRequest({ code, playerId: BOB.id, type: "rematch", now: T0 + 2 + firstMoveMs });

    const room = await rooms.askRequest({
      code,
      playerId: ALICE.id,
      type: "rematch",
      now: T0 + 3 + firstMoveMs,
    });

    expect(room.status).toBe("playing");
    expect(rooms.viewFor(room, ALICE.id).game.number).toBe(2);
  });

  it("ends the game against a player who stops moving once everyone has moved", async () => {
    const { rooms, code, published } = await started("timed-race");
    await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
    await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 3 });
    expect((await rooms.getRoom(code)).dueAt).toBe(T0 + 3 + 30_000);

    expect(await rooms.expireDue({ now: T0 + 3 + 30_000 })).toEqual([code]);

    const room = await rooms.getRoom(code);
    expect(room.result).toEqual({ status: "finished", result: "win", winners: [ALICE.id], reason: "idle" });
    expect(room.game.log.at(-1)).toEqual({ kind: "idle", playerIds: [BOB.id], at: T0 + 3 + 30_000 });
    expect(room.rematch).toEqual({ available: true });
    expect(published.filter(({ event }) => event === ROOM_EVENTS.GAME_FINISHED)).toHaveLength(1);
  });

  it("is a draw when every player is due and none of them moves", async () => {
    const { rooms, code } = await started("rps", { bestOf: 3 });
    await rooms.makeMove({ code, playerId: ALICE.id, move: { choice: "rock" }, now: T0 + 2 });
    await rooms.makeMove({ code, playerId: BOB.id, move: { choice: "scissors" }, now: T0 + 3 });

    await rooms.expireDue({ now: T0 + 3 + rpsEngine.turnLimitMs });

    expect((await rooms.getRoom(code)).result).toEqual({
      status: "finished",
      result: "draw",
      winners: [],
      reason: "idle",
    });
  });

  it("runs no limit after the first moves in a game without one", async () => {
    const { rooms, code } = await started();
    await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });

    const room = await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 3 });

    expect(rooms.viewFor(room, ALICE.id).game.turnEndsAt).toBe(0);
    expect(room.dueAt).toBe(0);
  });
});

describe("roomComponent requests for every page (CC-207)", () => {
  it("lists every room a player sits in, with or without a request, and what to tell them about it", async () => {
    const { rooms, code } = await finished();
    expect(await rooms.seatedRooms({ playerId: ALICE.id })).toEqual([await rooms.getRoom(code)]);
    const asked = await rooms.askRequest({ code, playerId: BOB.id, type: "rematch", now: T0 + 4 });

    expect(await rooms.seatedRooms({ playerId: ALICE.id })).toEqual([asked]);
    expect(await rooms.seatedRooms({ playerId: "guest_x" })).toEqual([]);
    expect(rooms.requestsView(asked)).toEqual({
      code,
      gameId: "race",
      names: { [ALICE.id]: "Alice", [BOB.id]: "Bob" },
      requests: asked.requests,
    });
  });

  const requestPushes = (published) =>
    published.filter(({ event }) => event === ROOM_EVENTS.REQUESTS_CHANGED).map(({ payload }) => payload);

  it("names the players to tell about a change of requests, as well as one whose seat it gave up", async () => {
    const { rooms, code, published } = await finished();
    await rooms.playerAway({ code, playerId: ALICE.id, now: T0 + 3 });
    await rooms.askRequest({ code, playerId: BOB.id, type: "rematch", now: T0 + 4 });
    expect(requestPushes(published).at(-1).playerIds).toEqual([ALICE.id, BOB.id]);

    await rooms.expireDue({ now: T0 + 3 + awayReleaseMs });

    const released = requestPushes(published).at(-1);
    expect(released.room.seats.map((seat) => seat.playerId)).toEqual([BOB.id]);
    expect(released.room.requests).toEqual([]);
    expect(released.playerIds).toEqual([ALICE.id, BOB.id]);
  });

  it("tells the players of a room that closes with a request that its requests have gone", async () => {
    const { rooms, code, published } = await finished();
    await rooms.askRequest({ code, playerId: BOB.id, type: "rematch", now: T0 + 4 });

    expect(await rooms.sweepExpired({ now: T0 + 3 + ROOM_LIFETIMES.rematchWindowMs })).toEqual([code]);

    const closed = requestPushes(published).at(-1);
    expect(closed.room.code).toBe(code);
    expect(closed.room.requests).toEqual([]);
    expect(closed.playerIds).toEqual([ALICE.id, BOB.id]);
  });

  it("says nothing about requests when a room without any closes", async () => {
    const { rooms, code, published } = await finished();
    const before = requestPushes(published).length;

    await rooms.sweepExpired({ now: T0 + 3 + ROOM_LIFETIMES.rematchWindowMs });

    expect(requestPushes(published)).toHaveLength(before);
    expect(published.at(-1).payload.code).toBe(code);
  });

  it("names nothing for rooms stored before requests existed", async () => {
    const { rooms, code } = await finished();
    const { requests, ...old } = await rooms.getRoom(code);

    expect(requests).toBeUndefined();
    expect(rooms.requestsView(old).requests).toEqual([]);
  });
});

describe("roomComponent game numbers of rooms stored before games were numbered", () => {
  const unnumbered = (room) => ({ ...room, game: { ...room.game, number: undefined } });

  it("counts the series", async () => {
    const done = await finished();
    const room = await done.rooms.getRoom(done.code);
    expect(done.rooms.viewFor(unnumbered(room), ALICE.id).game.number).toBe(1);

    const again = await done.rooms.askRequest({
      code: done.code,
      playerId: BOB.id,
      type: "rematch",
      now: T0 + 4,
    });
    const next = await done.rooms.askRequest({
      code: done.code,
      playerId: ALICE.id,
      type: "rematch",
      now: T0 + 5,
    });
    expect(again.status).toBe("finished");
    expect(done.rooms.viewFor(unnumbered(next), ALICE.id).game.number).toBe(2);
  });

  it("counts an aborted game as the one after the series", async () => {
    const { rooms, code } = await started();
    await rooms.expireDue({ now: T0 + 1 + firstMoveMs });
    const room = await rooms.getRoom(code);

    expect(rooms.viewFor(unnumbered({ ...room, series: { games: 2, wins: {} } }), ALICE.id).game.number).toBe(
      3,
    );
  });
});
