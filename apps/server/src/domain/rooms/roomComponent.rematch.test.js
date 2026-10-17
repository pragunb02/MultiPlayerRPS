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
const REMATCH = "rematch";

/** Room component over the real accessor + in-memory DAO; match ids m1, m2, … */
function setup() {
  const published = [];
  let matchNumber = 0;
  const rooms = createRoomComponent({
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry([raceEngine]),
    events: { emit: (event, payload) => event !== ROOM_EVENTS.CHANGED && published.push({ event, payload }) },
    generateCode: () => "ROOM22",
    generateSeed: () => 42, // seed 42: the second seat moves first
    generateMatchId: () => `m${++matchNumber}`,
  });
  return { rooms, published, code: "ROOM22" };
}

/** Alice hosts, Bob joins and moves first (seed 42); Alice reaches 3 and wins. */
async function finishedGame() {
  const ctx = setup();
  await ctx.rooms.createRoom({
    network: "net-a",
    host: ALICE,
    gameId: "race",
    options: { target: 3 },
    now: T0,
  });
  await ctx.rooms.joinRoom({ code: ctx.code, player: BOB, now: T0 + 1 });
  await ctx.rooms.makeMove({ code: ctx.code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
  await ctx.rooms.makeMove({ code: ctx.code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 3 });
  return ctx;
}

const ask = (rooms, { code, playerId, now }) => rooms.askRequest({ code, playerId, type: REMATCH, now });
const answer = (rooms, { code, playerId, now, reply }) =>
  rooms.answerRequest({ code, playerId, type: REMATCH, answer: reply, now });
const rematchRequest = (overrides) => ({
  type: REMATCH,
  from: BOB.id,
  to: ALICE.id,
  createdAt: T0 + 4,
  expiresAt: T0 + 4 + ROOM_LIFETIMES.rematchRequestMs,
  state: "open",
  endedAt: 0,
  ...overrides,
});

describe("roomComponent rematch (CC-037, CC-159)", () => {
  it("offers a rematch once a game is played out", async () => {
    const { rooms, code } = await finishedGame();

    const view = rooms.viewFor(await rooms.getRoom(code), ALICE.id);

    expect(view.rematch).toEqual({ available: true, until: UNTIL });
    expect(view.requests).toEqual([]);
    expect(view.series).toEqual({ games: 1, wins: { [ALICE.id]: 1 } });
  });

  it("opens a request for a minute, addressed to the opponent, without moving the end of the rematch window", async () => {
    const { rooms, code, published } = await finishedGame();

    const room = await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });

    expect(room.status).toBe("finished");
    expect(rooms.viewFor(room, ALICE.id).requests).toEqual([rematchRequest()]);
    expect(rooms.viewFor(room, ALICE.id).rematch.until).toBe(UNTIL);
    expect(published.at(-1)).toEqual({ event: ROOM_EVENTS.REQUESTS_CHANGED, payload: { room } });
    expect(room.dueAt).toBe(T0 + 4 + ROOM_LIFETIMES.rematchRequestMs);
    expect(await rooms.sweepExpired({ now: UNTIL })).toEqual([code]);
  });

  it("refuses asking twice while the request is open", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });

    await expect(ask(rooms, { code, playerId: BOB.id, now: T0 + 5 })).rejects.toThrow(/already asked/);
  });

  it("is withdrawn by the asker, and the answer is kept for both to see", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });

    const room = await answer(rooms, { code, playerId: BOB.id, now: T0 + 5, reply: "withdraw" });

    expect(room.requests).toEqual([rematchRequest({ state: "withdrawn", endedAt: T0 + 5 })]);
    expect(room.lastActivityAt).toBe(T0 + 5);
  });

  it("starts a new game in the same room once accepted, with the seats reversed", async () => {
    const { rooms, code, published } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });

    const room = await answer(rooms, { code, playerId: ALICE.id, now: T0 + 5, reply: "accept" });

    expect(room.code).toBe(code);
    expect(room.status).toBe("playing");
    expect(room.options).toEqual({ target: 3 });
    expect(room.seats.map((seat) => seat.playerId)).toEqual([BOB.id, ALICE.id]);
    expect(room.game).toEqual({
      matchId: "m2",
      number: 2,
      seed: 42,
      startedAt: T0 + 5,
      state: expect.any(Object),
      log: [],
    });
    expect(room.result).toBeUndefined();
    expect(room.rematch).toBeUndefined();
    expect(room.series).toEqual({ games: 1, wins: { [ALICE.id]: 1 } });
    // Both players see that it was accepted, for a moment.
    expect(rooms.viewFor(room, BOB.id).requests).toEqual([
      rematchRequest({ state: "accepted", endedAt: T0 + 5 }),
    ]);
    // Seed 42 lets the second seat start: now Alice, last game Bob. The first move alternates.
    expect(rooms.viewFor(room, ALICE.id).game.activePlayers).toEqual([ALICE.id]);
    expect(rooms.viewFor(room, ALICE.id).game.number).toBe(2);
    expect(published.filter((p) => p.event === ROOM_EVENTS.GAME_FINISHED)).toHaveLength(1);
  });

  it("starts the next game when both players ask, because asking for what you were asked accepts it", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });

    const room = await ask(rooms, { code, playerId: ALICE.id, now: T0 + 5 });

    expect(room.status).toBe("playing");
    expect(room.requests).toEqual([rematchRequest({ state: "accepted", endedAt: T0 + 5 })]);
  });

  it("counts the series across rematches", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });
    await ask(rooms, { code, playerId: ALICE.id, now: T0 + 5 });
    await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 6 });

    const room = await rooms.makeMove({ code, playerId: BOB.id, move: { add: 2 }, now: T0 + 7 });

    expect(rooms.viewFor(room, BOB.id)).toEqual(
      expect.objectContaining({
        status: "finished",
        rematch: { available: true, until: T0 + 7 + ROOM_LIFETIMES.rematchWindowMs },
        series: { games: 2, wins: { [ALICE.id]: 1, [BOB.id]: 1 } },
      }),
    );
  });

  it("is not offered after a forfeit", async () => {
    const ctx = setup();
    await ctx.rooms.createRoom({
      network: "net-a",
      host: ALICE,
      gameId: "race",
      options: { target: 3 },
      now: T0,
    });
    await ctx.rooms.joinRoom({ code: ctx.code, player: BOB, now: T0 + 1 });
    await ctx.rooms.leaveRoom({ code: ctx.code, playerId: BOB.id, now: T0 + 2 });

    expect(ctx.rooms.viewFor(await ctx.rooms.getRoom(ctx.code), ALICE.id).rematch).toEqual({
      available: false,
      until: T0 + 2 + ROOM_LIFETIMES.rematchWindowMs,
    });
    await expect(ask(ctx.rooms, { code: ctx.code, playerId: ALICE.id, now: T0 + 3 })).rejects.toThrow(
      /opponent left/,
    );
  });

  it("ends when a player leaves the finished room, and the open request goes with it", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: ALICE.id, now: T0 + 4 });

    const { room } = await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 5 });

    expect(room.rematch).toEqual({ available: false, leftName: BOB.displayName });
    expect(room.requests).toEqual([]);
    await expect(ask(rooms, { code, playerId: ALICE.id, now: T0 + 6 })).rejects.toThrow(/opponent left/);
  });

  it("tells the player still there who left the finished game, though the seat is gone (CC-162)", async () => {
    const { rooms, code } = await finishedGame();

    const { room } = await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 5 });

    expect(room.seats.map((seat) => seat.playerId)).toEqual([ALICE.id]);
    expect(rooms.viewFor(room, ALICE.id).rematch).toEqual(
      expect.objectContaining({ available: false, leftName: BOB.displayName }),
    );
  });

  it("names nobody in a finished game that everyone is still in", async () => {
    const { rooms, code } = await finishedGame();

    const view = rooms.viewFor(await rooms.getRoom(code), ALICE.id);

    expect(view.rematch).not.toHaveProperty("leftName");
  });

  it("refuses a rematch before the game is over", async () => {
    const { rooms, code } = setup();
    await rooms.createRoom({
      network: "net-a",
      host: ALICE,
      gameId: "race",
      options: { target: 3 },
      now: T0,
    });
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });

    await expect(ask(rooms, { code, playerId: ALICE.id, now: T0 + 2 })).rejects.toThrow(
      "A rematch is only possible after the game is over",
    );
  });

  it("refuses someone without a seat", async () => {
    const { rooms, code } = await finishedGame();

    await expect(ask(rooms, { code, playerId: CAROL.id, now: T0 + 4 })).rejects.toThrow(ForbiddenError);
  });

  it("refuses an unknown room", async () => {
    const { rooms } = setup();

    await expect(ask(rooms, { code: "NOPE22", playerId: ALICE.id, now: T0 })).rejects.toThrow(NotFoundError);
  });

  it("has no rematch or series in a room that has not finished a game", async () => {
    const { rooms } = setup();
    const room = await rooms.createRoom({
      network: "net-a",
      host: ALICE,
      gameId: "race",
      options: { target: 3 },
      now: T0,
    });

    const view = rooms.viewFor(room, ALICE.id);

    expect(view).not.toHaveProperty("rematch");
    expect(view).not.toHaveProperty("series");
  });

  it("keeps a guest's series wins and requests when they sign in during the rematch", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });
    const account = { kind: "user", id: "user_a", displayName: "alice" };

    await rooms.transferPlayer({ from: ALICE.id, to: account, now: T0 + 6 });

    const room = await rooms.getRoom(code);
    expect(room.series).toEqual({ games: 1, wins: { user_a: 1 } });
    expect(room.requests).toEqual([rematchRequest({ to: "user_a" })]);
  });

  it("cannot be asked for once the rematch window has ended, and says why the room closed", async () => {
    const { rooms, code, published } = await finishedGame();

    const error = await ask(rooms, { code, playerId: ALICE.id, now: UNTIL }).catch((err) => err);

    expect(error).toBeInstanceOf(GoneError);
    expect(error.details).toEqual({ reason: "rematch-window-ended", gameId: "race", closedAt: UNTIL });
    expect(published.at(-1)).toEqual({
      event: ROOM_EVENTS.CLOSED,
      payload: { code, reason: "rematch-window-ended" },
    });
  });

  it("can still be accepted a moment before the window ends, after a long time on the result screen", async () => {
    const { rooms, code } = await finishedGame();
    const late = UNTIL - 30_000;
    await ask(rooms, { code, playerId: BOB.id, now: late });

    const room = await answer(rooms, { code, playerId: ALICE.id, now: UNTIL - 1, reply: "accept" });

    expect(room.status).toBe("playing");
    expect(room).not.toHaveProperty("finishedAt");
  });
});

describe("roomComponent declining a rematch (CC-104, CC-159)", () => {
  it("ends the request as declined, so the asker is told, and keeps a rematch possible", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });

    const room = await answer(rooms, { code, playerId: ALICE.id, now: T0 + 5, reply: "decline" });

    expect(room.status).toBe("finished");
    expect(rooms.viewFor(room, BOB.id)).toEqual(
      expect.objectContaining({
        rematch: { available: true, until: UNTIL },
        requests: [rematchRequest({ state: "declined", endedAt: T0 + 5 })],
        // Bob may ask again once the cooldown is over, and the page can say when.
        askAgainAt: { rematch: T0 + 5 + ROOM_LIFETIMES.reaskCooldownMs },
      }),
    );
    expect(rooms.viewFor(room, ALICE.id).askAgainAt).toEqual({});
    expect(room.lastActivityAt).toBe(T0 + 5);
  });

  it("lets the asker ask again once the cooldown is over, and the decliner change their mind at once", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });
    await answer(rooms, { code, playerId: ALICE.id, now: T0 + 5, reply: "decline" });

    await expect(ask(rooms, { code, playerId: BOB.id, now: T0 + 6 })).rejects.toThrow(/Wait a few seconds/);
    const asked = await ask(rooms, { code, playerId: ALICE.id, now: T0 + 6 });
    expect(asked.requests.at(-1)).toEqual(
      expect.objectContaining({ from: ALICE.id, to: BOB.id, state: "open" }),
    );
    expect((await ask(rooms, { code, playerId: BOB.id, now: T0 + 7 })).status).toBe("playing");
  });

  it("forgets the old answer once it has been shown and the cooldown is over", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });
    await answer(rooms, { code, playerId: ALICE.id, now: T0 + 5, reply: "decline" });

    const room = await ask(rooms, { code, playerId: BOB.id, now: T0 + 5 + ROOM_LIFETIMES.reaskCooldownMs });

    expect(room.requests).toEqual([
      rematchRequest({
        createdAt: T0 + 5 + ROOM_LIFETIMES.reaskCooldownMs,
        expiresAt: T0 + 5 + ROOM_LIFETIMES.reaskCooldownMs + ROOM_LIFETIMES.rematchRequestMs,
      }),
    ]);
  });

  it("refuses answers that are not yours to give", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });

    await expect(answer(rooms, { code, playerId: BOB.id, now: T0 + 5, reply: "decline" })).rejects.toThrow(
      "That was not asked of you",
    );
    await expect(answer(rooms, { code, playerId: BOB.id, now: T0 + 5, reply: "accept" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(answer(rooms, { code, playerId: ALICE.id, now: T0 + 5, reply: "withdraw" })).rejects.toThrow(
      "Only the player who asked can withdraw it",
    );
    await expect(answer(rooms, { code, playerId: CAROL.id, now: T0 + 5, reply: "decline" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("refuses an answer when nothing is open, including after the opponent left", async () => {
    const { rooms, code } = await finishedGame();

    await expect(answer(rooms, { code, playerId: BOB.id, now: T0 + 4, reply: "decline" })).rejects.toThrow(
      ConflictError,
    );
    await ask(rooms, { code, playerId: ALICE.id, now: T0 + 4 });
    await rooms.leaveRoom({ code, playerId: ALICE.id, now: T0 + 6 });
    await expect(answer(rooms, { code, playerId: BOB.id, now: T0 + 7, reply: "decline" })).rejects.toThrow(
      "That request is no longer open",
    );
  });

  it("cannot be declined once the rematch window has ended, and says why the room closed (CC-101)", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: ALICE.id, now: UNTIL - 1_000 });

    const error = await answer(rooms, { code, playerId: BOB.id, now: UNTIL, reply: "decline" }).catch(
      (err) => err,
    );

    expect(error).toBeInstanceOf(GoneError);
    expect(error.details).toEqual({ reason: "rematch-window-ended", gameId: "race", closedAt: UNTIL });
  });

  it("ignores what rooms stored before requests existed said about rematches", async () => {
    const { rooms, code } = await finishedGame();
    const stored = { ...(await rooms.getRoom(code)), requests: undefined };
    const old = { ...stored, rematch: { requestedBy: [BOB.id], available: true, declinedBy: "" } };

    const view = rooms.viewFor(old, ALICE.id);

    expect(view.rematch).toEqual({ available: true, until: UNTIL });
    expect(view.requests).toEqual([]);
  });
});

describe("roomComponent rematch requests nobody answers (CC-159)", () => {
  it("expire after a minute through the deadline sweep, and the asker is told", async () => {
    const { rooms, code, published } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });
    const due = T0 + 4 + ROOM_LIFETIMES.rematchRequestMs;

    expect(await rooms.expireDue({ now: due - 1 })).toEqual([]);
    expect(await rooms.expireDue({ now: due })).toEqual([code]);

    const room = await rooms.getRoom(code);
    expect(room.requests).toEqual([rematchRequest({ state: "expired", endedAt: due })]);
    expect(room.dueAt).toBe(0);
    expect(published.slice(-2).map(({ event }) => event)).toEqual([
      ROOM_EVENTS.REQUESTS_CHANGED,
      ROOM_EVENTS.UPDATED,
    ]);
  });

  it("can be asked again after expiring, once the cooldown is over", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });
    const expired = T0 + 4 + ROOM_LIFETIMES.rematchRequestMs;

    await expect(ask(rooms, { code, playerId: BOB.id, now: expired + 1 })).rejects.toThrow(/Wait/);
    const room = await ask(rooms, { code, playerId: BOB.id, now: expired + ROOM_LIFETIMES.reaskCooldownMs });

    expect(room.requests.map((request) => request.state)).toEqual(["open"]);
  });

  it("cannot be accepted once expired, even before the sweep has run", async () => {
    const { rooms, code } = await finishedGame();
    await ask(rooms, { code, playerId: BOB.id, now: T0 + 4 });

    await expect(
      answer(rooms, {
        code,
        playerId: ALICE.id,
        now: T0 + 4 + ROOM_LIFETIMES.rematchRequestMs,
        reply: "accept",
      }),
    ).rejects.toThrow("That request is no longer open");
  });
});
