import { describe, expect, it } from "vitest";
import { createEngineRegistry, defineEngine, ENGINES } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { DELETED_PLAYER_NAME } from "@classicade/shared";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { botIdentity } from "../../models/botIdentity.js";
import { deletedPlayer } from "../../models/deletedPlayer.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { createRoomComponent } from "./roomComponent.js";
import { createSeatIds } from "./seatIds.js";

// Ids in the real shapes, so a test can look for them anywhere in what a client receives.
const ALICE = Object.freeze({
  kind: "user",
  id: "user_65f1a2b3c4d5e6f708192a3b",
  displayName: "Alice",
});
const BOB = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-00000000000b",
  displayName: "Guest-Bob1",
});
const CAROL = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-00000000000c",
  displayName: "Guest-Carol",
});
const SECRET = "seat-secret-for-tests-only-0123456789abcdef";
const T0 = 1_000_000;

/** Rooms with the real engines and the real seat ids. Codes ROOM22, ROOM23, … */
function setup({ engines = ENGINES } = {}) {
  let codes = 22;
  const seatIds = createSeatIds({ secret: SECRET });
  const rooms = createRoomComponent({
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry(engines),
    events: { emit: () => {} },
    seatIds,
    generateCode: () => `ROOM${codes++}`,
    generateSeed: () => 42,
  });
  return { rooms, seatIds };
}

/** Everything a client would receive, as the text that goes over the wire. */
const wire = (value) => JSON.stringify(value);

/** Alice hosts best-of-3 Rock Paper Scissors and Bob joins, so the game starts. */
async function rpsGame(rooms) {
  const room = await rooms.createRoom({
    network: "net-a",
    host: ALICE,
    gameId: "rps",
    options: { bestOf: 3 },
    now: T0,
  });
  await rooms.joinRoom({ code: room.code, player: BOB, now: T0 + 1 });
  return room.code;
}

const choose = (rooms, { code, player, choice, now }) =>
  rooms.makeMove({ code, playerId: player.id, move: { choice }, now });

/** Alice wins best-of-3 two rounds to nothing. */
async function finishedRps(rooms) {
  const code = await rpsGame(rooms);
  await choose(rooms, { code, player: ALICE, choice: "rock", now: T0 + 2 });
  await choose(rooms, { code, player: BOB, choice: "scissors", now: T0 + 3 });
  await choose(rooms, { code, player: ALICE, choice: "rock", now: T0 + 4 });
  await choose(rooms, { code, player: BOB, choice: "scissors", now: T0 + 5 });
  return code;
}

describe("room views name players by seat id (CC-253)", () => {
  it("sends no player id to a seated player during a game, the engine's view included", async () => {
    const { rooms, seatIds } = setup();
    const code = await rpsGame(rooms);
    const room = await choose(rooms, { code, player: ALICE, choice: "rock", now: T0 + 2 });

    const view = rooms.viewFor(room, BOB.id);

    expect(wire(view)).not.toContain(ALICE.id);
    expect(wire(view)).not.toContain(BOB.id);
    const alice = seatIds.seatIdOf(room, ALICE.id);
    const bob = seatIds.seatIdOf(room, BOB.id);
    expect(view.seats.map((seat) => seat.playerId)).toEqual([alice, bob]);
    expect(view.hostId).toBe(alice);
    expect(view.you).toBe(bob);
    expect(view.game.view.hasChosen).toEqual({ [alice]: true, [bob]: false });
    expect(view.game.activePlayers).toEqual([bob]);
  });

  it("sends no player id to a viewer without a seat, whose `you` is empty", async () => {
    const { rooms } = setup();
    const code = await rpsGame(rooms);

    const view = rooms.viewFor(await rooms.getRoom(code), CAROL.id);

    expect(view.you).toBe("");
    expect(wire(view)).not.toContain(ALICE.id);
    expect(wire(view)).not.toContain(BOB.id);
  });

  it("keeps the names and presence of each seat as they are", async () => {
    const { rooms } = setup();
    const code = await rpsGame(rooms);

    const view = rooms.viewFor(await rooms.getRoom(code), ALICE.id);

    expect(view.seats).toEqual([
      expect.objectContaining({ displayName: "Alice", connected: true, presence: "here" }),
      expect.objectContaining({ displayName: "Guest-Bob1", connected: true, presence: "here" }),
    ]);
  });

  it("names the winner, the score and the series by seat id once the game is over", async () => {
    const { rooms, seatIds } = setup();
    const code = await finishedRps(rooms);
    const room = await rooms.getRoom(code);

    const view = rooms.viewFor(room, ALICE.id);

    const alice = seatIds.seatIdOf(room, ALICE.id);
    expect(view.game.outcome.winners).toEqual([alice]);
    expect(view.series.wins).toEqual({ [alice]: 1 });
    expect(view.game.view.rounds[0].winner).toBe(alice);
    expect(wire(view)).not.toContain(ALICE.id);
    expect(wire(view)).not.toContain(BOB.id);
  });

  it("keeps every seat id through a rematch, where the seats swap", async () => {
    const { rooms } = setup();
    const code = await finishedRps(rooms);
    const before = rooms.viewFor(await rooms.getRoom(code), ALICE.id);
    const asked = await rooms.askRequest({ code, playerId: BOB.id, type: "rematch", now: T0 + 6 });
    const askedView = rooms.viewFor(asked, ALICE.id);

    const rematch = await rooms.askRequest({ code, playerId: ALICE.id, type: "rematch", now: T0 + 7 });
    const after = rooms.viewFor(rematch, ALICE.id);

    const [alice, bob] = before.seats.map((seat) => seat.playerId);
    expect(askedView.requests).toEqual([expect.objectContaining({ from: bob, to: alice, state: "open" })]);
    expect(after.game.number).toBe(2);
    expect(after.seats.map((seat) => seat.playerId)).toEqual([bob, alice]);
    expect(after.you).toBe(alice);
    expect(wire(after)).not.toContain(ALICE.id);
    expect(wire(after)).not.toContain(BOB.id);
  });

  it("gives the same player an unrelated seat id in their next room", async () => {
    const { rooms } = setup();
    const first = rooms.viewFor(await rooms.getRoom(await rpsGame(rooms)), ALICE.id);

    const second = rooms.viewFor(await rooms.getRoom(await rpsGame(rooms)), ALICE.id);

    expect(second.code).not.toBe(first.code);
    expect(second.you).not.toBe(first.you);
    expect(second.seats[1].playerId).not.toBe(first.seats[1].playerId);
  });

  it("hides a player who left an aborted game, whom only the game's state still names", async () => {
    const { rooms } = setup();
    const code = await rpsGame(rooms);
    // Nobody moves, so the game is aborted (CC-036): no move, result or series names either player.
    await rooms.expireDue({ now: T0 + 10 * 60 * 1000 });
    const left = await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 10 * 60 * 1000 + 1 });

    const view = rooms.viewFor(left.room, ALICE.id);

    expect(view.seats).toHaveLength(1);
    expect(view.game.outcome.reason).toBe("aborted");
    expect(Object.keys(view.game.view.hasChosen)).toHaveLength(2);
    expect(wire(view)).not.toContain(BOB.id);
    expect(wire(view)).not.toContain(ALICE.id);
  });

  it("labels a deleted player's stand-in, so the page needs nothing from its id", async () => {
    const { rooms } = setup();
    const code = await rpsGame(rooms);
    const [room] = await rooms.erasePlayer({
      playerId: BOB.id,
      standIn: () => deletedPlayer("00000000-0000-4000-8000-0000000000dd"),
      now: T0 + 2,
    });

    const view = rooms.viewFor(room, ALICE.id);

    expect(view.seats[1]).toEqual(
      expect.objectContaining({ displayName: DELETED_PLAYER_NAME, deleted: true }),
    );
    expect(view.seats[0].deleted).toBeUndefined();
    expect(wire(view)).not.toContain("deleted_");
    expect(code).toBe(view.code);
  });

  it("names a computer player by seat id too, still labelled as a computer", async () => {
    const { rooms } = setup();
    const room = await rooms.createRoom({
      network: "net-a",
      host: ALICE,
      gameId: "rps",
      options: { bestOf: 1 },
      now: T0,
    });
    const bot = botIdentity({ gameId: "rps", level: "easy" });
    const joined = await rooms.joinRoom({ code: room.code, player: bot, now: T0 + 1 });

    const view = rooms.viewFor(joined, ALICE.id);

    expect(view.seats[1].bot).toEqual(bot.bot);
    expect(wire(view)).not.toContain(bot.id);
  });

  it("tells each player the room's requests by seat id, with their own seat id as `you`", async () => {
    const { rooms, seatIds } = setup();
    const code = await finishedRps(rooms);
    const room = await rooms.askRequest({ code, playerId: BOB.id, type: "rematch", now: T0 + 6 });

    const forAlice = rooms.requestsView(room, ALICE.id);
    const forBob = rooms.requestsView(room, BOB.id);

    const alice = seatIds.seatIdOf(room, ALICE.id);
    const bob = seatIds.seatIdOf(room, BOB.id);
    expect(forAlice).toEqual({
      code,
      gameId: "rps",
      you: alice,
      names: { [alice]: "Alice", [bob]: "Guest-Bob1" },
      requests: [expect.objectContaining({ type: "rematch", from: bob, to: alice })],
    });
    expect(forBob.you).toBe(bob);
    expect(wire([forAlice, forBob])).not.toContain(ALICE.id);
    expect(wire([forAlice, forBob])).not.toContain(BOB.id);
  });

  it("hides a chess player who lost on time and left, whom only the game's state still names", async () => {
    const { rooms } = setup();
    const { code } = await rooms.createRoom({
      network: "net-a",
      host: ALICE,
      gameId: "chess",
      options: { timeControl: "bullet-1+0" },
      now: T0,
    });
    const started = await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });
    const { w: white, b: black } = started.game.state.byColor;
    const pawn = { type: "move", from: "e2", to: "e4" };
    await rooms.makeMove({ code, playerId: white, move: pawn, now: T0 + 2 });
    // Black never moves and their minute runs out: the log says only that a clock ran out, the winner is White.
    await rooms.expireDue({ now: T0 + 2 + 60_000 });
    const left = await rooms.leaveRoom({ code, playerId: black, now: T0 + 2 + 60_001 });

    const view = rooms.viewFor(left.room, white);

    expect(view.game.outcome).toEqual(expect.objectContaining({ reason: "timeout" }));
    expect(view.seats).toHaveLength(1);
    expect(Object.keys(view.game.view.colors)).toHaveLength(2);
    expect(wire(view)).not.toContain(black);
    expect(wire(view)).not.toContain(white);
  });

  it("stores nothing for seat ids: a game keeps only what it kept before", async () => {
    const { rooms } = setup();
    const code = await rpsGame(rooms);

    const room = await rooms.getRoom(code);

    expect(Object.keys(room.game).sort()).toEqual(["log", "matchId", "number", "seed", "startedAt", "state"]);
  });

  it("names by seat id anything shaped like a player id that a game's view names, even someone it does not list", async () => {
    const STRANGER = "user_65f1a2b3c4d5e6f7081900ff";
    const GUEST_STRANGER = "guest_00000000-0000-4000-8000-0000000000ff";
    const leaky = defineEngine({
      ...raceEngine,
      id: "leaky",
      viewFor: (state) => ({
        ...raceEngine.viewFor(state),
        [STRANGER]: [STRANGER, GUEST_STRANGER, "not-an-id"],
      }),
    });
    const { rooms, seatIds } = setup({ engines: [leaky] });
    const room = await rooms.createRoom({
      network: "net-a",
      host: ALICE,
      gameId: "leaky",
      options: { target: 3 },
      now: T0,
    });
    const started = await rooms.joinRoom({ code: room.code, player: BOB, now: T0 + 1 });

    const view = rooms.viewFor(started, ALICE.id);

    const stranger = seatIds.seatIdOf(started, STRANGER);
    expect(view.game.view[stranger]).toEqual([
      stranger,
      seatIds.seatIdOf(started, GUEST_STRANGER),
      "not-an-id",
    ]);
    expect(wire(view)).not.toContain(STRANGER);
    expect(wire(view)).not.toContain(GUEST_STRANGER);
  });

  it("keeps a display name that only starts like a player id, and still renames the real ids (CC-304)", async () => {
    const USER_BOB = Object.freeze({
      kind: "user",
      id: "user_0123456789abcdef01234567",
      displayName: "user_bob",
    });
    const { rooms, seatIds } = setup();
    const room = await rooms.createRoom({
      network: "net-a",
      host: ALICE,
      gameId: "rps",
      options: { bestOf: 1 },
      now: T0,
    });
    const joined = await rooms.joinRoom({ code: room.code, player: USER_BOB, now: T0 + 1 });

    const view = rooms.viewFor(joined, ALICE.id);
    const requests = rooms.requestsView(joined, ALICE.id);

    const bob = seatIds.seatIdOf(joined, USER_BOB.id);
    expect(view.seats[1]).toEqual(expect.objectContaining({ playerId: bob, displayName: "user_bob" }));
    expect(requests.names[bob]).toBe("user_bob");
    expect(wire([view, requests])).not.toContain(USER_BOB.id);
    expect(wire([view, requests])).not.toContain(ALICE.id);
  });

  it("keeps text in a game's view that only starts like a player id, and renames a real id beside it (CC-304)", async () => {
    const STRANGER = "user_65f1a2b3c4d5e6f7081900ff";
    const named = defineEngine({
      ...raceEngine,
      id: "named",
      viewFor: (state) => ({ ...raceEngine.viewFor(state), caption: ["user_bob", "deleted_bob", STRANGER] }),
    });
    const { rooms, seatIds } = setup({ engines: [named] });
    const room = await rooms.createRoom({
      network: "net-a",
      host: ALICE,
      gameId: "named",
      options: { target: 3 },
      now: T0,
    });
    const started = await rooms.joinRoom({ code: room.code, player: BOB, now: T0 + 1 });

    const view = rooms.viewFor(started, ALICE.id);

    expect(view.game.view.caption).toEqual(["user_bob", "deleted_bob", seatIds.seatIdOf(started, STRANGER)]);
    expect(wire(view)).not.toContain(STRANGER);
  });

  it("refuses to be built without seat ids, so a room view can never fall back to player ids", () => {
    expect(() =>
      createRoomComponent({
        roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
        engines: createEngineRegistry(ENGINES),
        events: { emit: () => {} },
      }),
    ).toThrow(TypeError);
  });
});
