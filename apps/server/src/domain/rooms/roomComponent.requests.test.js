import { describe, expect, it } from "vitest";
import { createEngineRegistry, defineEngine, ENGINES } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { ConflictError, ValidationError } from "../../utils/errors.js";
import { createRoomComponent, ROOM_EVENTS } from "./roomComponent.js";
import { ROOM_LIFETIMES } from "./roomLifetimes.js";

// Requests of a game during play (CC-159), through the chess draw offer: one open at a time, thirty seconds to
// answer, three a game for each player, declined by moving, and gone once the game is over.

const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const CAROL = Object.freeze({ kind: "guest", id: "guest_c", displayName: "Carol" });
const T0 = 1_000_000;
const DRAW = "draw";
const DRAW_MS = 30_000;
// A race for three players, to show that a request needs exactly one other player.
const trioRace = defineEngine({ ...raceEngine, id: "trio", players: { min: 3, max: 3 } });
const chessEngine = ENGINES.find((engine) => engine.id === "chess");

function setup() {
  const published = [];
  const rooms = createRoomComponent({
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry([chessEngine, raceEngine, trioRace]),
    events: { emit: (event, payload) => published.push({ event, payload }) },
    generateCode: () => "ROOM22",
    generateSeed: () => 42,
    generateMatchId: () => "m1",
  });
  return { rooms, published, code: "ROOM22" };
}

/** Alice hosts chess and Bob joins. With seed 42 Bob plays White and moves first. */
async function chessGame() {
  const ctx = setup();
  await ctx.rooms.createRoom({ network: "net-a", host: ALICE, gameId: "chess", options: {}, now: T0 });
  await ctx.rooms.joinRoom({ code: ctx.code, player: BOB, now: T0 + 1 });
  return ctx;
}

const offer = (rooms, { code, playerId, now }) => rooms.askRequest({ code, playerId, type: DRAW, now });
const answer = (rooms, { code, playerId, now, reply }) =>
  rooms.answerRequest({ code, playerId, type: DRAW, answer: reply, now });
const move = (rooms, { code, playerId, now, from, to }) =>
  rooms.makeMove({ code, playerId, move: { type: "move", from, to }, now });

describe("roomComponent requests of a game (CC-159)", () => {
  it("opens a draw offer for thirty seconds, and counts it against the offerer's three", async () => {
    const { rooms, code, published } = await chessGame();

    const room = await offer(rooms, { code, playerId: BOB.id, now: T0 + 2 });

    expect(room.requests).toEqual([
      {
        type: DRAW,
        from: BOB.id,
        to: ALICE.id,
        createdAt: T0 + 2,
        expiresAt: T0 + 2 + DRAW_MS,
        state: "open",
        endedAt: 0,
      },
    ]);
    expect(rooms.viewFor(room, BOB.id).requestsLeft).toEqual({ draw: 2 });
    expect(rooms.viewFor(room, ALICE.id).requestsLeft).toEqual({ draw: 3 });
    expect(rooms.viewFor(room, CAROL.id).requestsLeft).toEqual({});
    expect(published.at(-1).event).toBe(ROOM_EVENTS.REQUESTS_CHANGED);
  });

  it("ends the game in a draw by agreement when accepted, logged so the match replays", async () => {
    const { rooms, code, published } = await chessGame();
    await offer(rooms, { code, playerId: BOB.id, now: T0 + 2 });

    const room = await answer(rooms, { code, playerId: ALICE.id, now: T0 + 3, reply: "accept" });

    expect(room.status).toBe("finished");
    expect(room.result).toEqual({ status: "finished", result: "draw", winners: [], reason: "agreement" });
    expect(room.game.log).toEqual([
      { kind: "agree", type: DRAW, from: BOB.id, playerId: ALICE.id, at: T0 + 3 },
    ]);
    expect(room.requests[0]).toEqual(expect.objectContaining({ state: "accepted", endedAt: T0 + 3 }));
    expect(room.rematch).toEqual({ available: true });
    expect(published.filter(({ event }) => event === ROOM_EVENTS.GAME_FINISHED)).toHaveLength(1);
  });

  it("accepts the opponent's offer when the other player offers a draw as well", async () => {
    const { rooms, code } = await chessGame();
    await offer(rooms, { code, playerId: BOB.id, now: T0 + 2 });

    const room = await offer(rooms, { code, playerId: ALICE.id, now: T0 + 3 });

    expect(room.result.reason).toBe("agreement");
  });

  it("is declined when the player asked makes a move instead, and stands through the offerer's own move", async () => {
    const { rooms, code } = await chessGame();
    await offer(rooms, { code, playerId: BOB.id, now: T0 + 2 });

    const own = await move(rooms, { code, playerId: BOB.id, now: T0 + 3, from: "e2", to: "e4" });
    expect(own.requests[0].state).toBe("open");
    const replied = await move(rooms, { code, playerId: ALICE.id, now: T0 + 4, from: "e7", to: "e5" });

    expect(replied.requests[0]).toEqual(expect.objectContaining({ state: "declined", endedAt: T0 + 4 }));
    expect(replied.status).toBe("playing");
  });

  it("lets each player offer three times a game, with a pause after every answer", async () => {
    const { rooms, code } = await chessGame();
    let now = T0 + 2;
    for (let round = 0; round < 3; round++) {
      await offer(rooms, { code, playerId: BOB.id, now });
      await answer(rooms, { code, playerId: ALICE.id, now: now + 1, reply: "decline" });
      await expect(offer(rooms, { code, playerId: BOB.id, now: now + 2 })).rejects.toThrow(/Wait a few/);
      now += 1 + ROOM_LIFETIMES.reaskCooldownMs;
    }

    await expect(offer(rooms, { code, playerId: BOB.id, now })).rejects.toThrow(
      "You can ask that 3 times a game",
    );
    expect(rooms.viewFor(await rooms.getRoom(code), BOB.id).requestsLeft).toEqual({ draw: 0 });
    expect((await offer(rooms, { code, playerId: ALICE.id, now })).requests.at(-1).from).toBe(ALICE.id);
  });

  it("expires after thirty seconds without an answer, through the deadline sweep", async () => {
    const { rooms, code } = await chessGame();
    await offer(rooms, { code, playerId: BOB.id, now: T0 + 2 });

    expect(await rooms.expireDue({ now: T0 + 2 + DRAW_MS })).toEqual([code]);

    const room = await rooms.getRoom(code);
    expect(room.requests[0]).toEqual(
      expect.objectContaining({ state: "expired", endedAt: T0 + 2 + DRAW_MS }),
    );
    expect(room.status).toBe("playing");
  });

  it("goes away without an answer when the game ends some other way", async () => {
    const { rooms, code } = await chessGame();
    await offer(rooms, { code, playerId: BOB.id, now: T0 + 2 });

    const room = await rooms.makeMove({ code, playerId: BOB.id, move: { type: "resign" }, now: T0 + 3 });

    expect(room.status).toBe("finished");
    expect(room.requests).toEqual([]);
  });

  it("refuses a draw offer outside the game, and a rematch during it", async () => {
    const { rooms, code } = await chessGame();
    await expect(rooms.askRequest({ code, playerId: BOB.id, type: "rematch", now: T0 + 2 })).rejects.toThrow(
      "A rematch is only possible after the game is over",
    );
    await rooms.makeMove({ code, playerId: BOB.id, move: { type: "resign" }, now: T0 + 3 });

    await expect(offer(rooms, { code, playerId: BOB.id, now: T0 + 4 })).rejects.toThrow(
      "That is only possible while the game is on",
    );
  });

  it("refuses kinds of request the game does not have", async () => {
    const { rooms, code } = await chessGame();

    await expect(rooms.askRequest({ code, playerId: BOB.id, type: "truce", now: T0 + 2 })).rejects.toThrow(
      ValidationError,
    );
    const race = setup();
    await race.rooms.createRoom({
      network: "net-a",
      host: ALICE,
      gameId: "race",
      options: { target: 3 },
      now: T0,
    });
    await race.rooms.joinRoom({ code: race.code, player: BOB, now: T0 + 1 });
    await expect(offer(race.rooms, { code: race.code, playerId: BOB.id, now: T0 + 2 })).rejects.toThrow(
      "You cannot ask that in this game",
    );
    expect(race.rooms.viewFor(await race.rooms.getRoom(race.code), BOB.id).requestsLeft).toEqual({});
  });

  it("needs exactly one other player to ask", async () => {
    const { rooms, code } = setup();
    await rooms.createRoom({
      network: "net-a",
      host: ALICE,
      gameId: "trio",
      options: { target: 3 },
      now: T0,
    });
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });
    await rooms.joinRoom({ code, player: CAROL, now: T0 + 2 });
    const room = await rooms.getRoom(code);
    const first = room.game.state.players[room.game.state.turn];
    await rooms.makeMove({ code, playerId: first, move: { add: 2 }, now: T0 + 3 });
    const second = (await rooms.getRoom(code)).game.state.players[(room.game.state.turn + 1) % 3];
    await rooms.makeMove({ code, playerId: second, move: { add: 1 }, now: T0 + 4 });

    await expect(
      rooms.askRequest({ code, playerId: ALICE.id, type: "rematch", now: T0 + 5 }),
    ).rejects.toThrow(new ConflictError("A request needs one other player in the room"));
  });
});
