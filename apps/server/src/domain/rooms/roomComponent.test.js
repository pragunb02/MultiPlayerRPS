import { describe, expect, it } from "vitest";
import { createEngineRegistry, defineEngine } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import {
  ConcurrentChangeError,
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  ValidationError,
} from "../../utils/errors.js";
import { createRoomComponent, ROOM_EVENTS } from "./roomComponent.js";
import { ROOM_LIFETIMES } from "./roomLifetimes.js";
import { TEST_SEAT_IDS } from "../../testing/seatIds.js";

const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const CAROL = Object.freeze({ kind: "guest", id: "guest_c", displayName: "Carol" });
/** The seat id a room view shows for a player (CC-253). */
const seatOf = (room, player) => TEST_SEAT_IDS.seatIdOf(room, player.id);
const T0 = 1_000_000;

// A 4-seat variant, so a waiting room can hold several players before it starts.
const partyEngine = defineEngine({ ...raceEngine, id: "party", players: { min: 2, max: 4 } });

/**
 * Room component over the real accessor and the in-memory DAO, with the reference "race" engine. `wrap` can
 * change what the accessor does, to play another server writing at the same moment or storage failing.
 */
function setup({
  codes = ["ROOM22", "ROOM33", "ROOM44"],
  engines = [raceEngine],
  wrap = (a) => a,
  botTurns,
} = {}) {
  // Every saved change is also published as CHANGED (for the bot driver). It is kept apart, so the tests of the
  // other events read as before.
  const published = [];
  const changes = [];
  const queue = [...codes];
  const accessor = createRoomAccessor({ roomDao: createInMemoryRoomDao() });
  const rooms = createRoomComponent({
    seatIds: TEST_SEAT_IDS,
    roomAccessor: wrap(accessor),
    engines: createEngineRegistry(engines),
    events: {
      emit: (event, payload) =>
        (event === ROOM_EVENTS.CHANGED ? changes : published).push({ event, payload }),
    },
    generateCode: () => queue.shift(),
    generateSeed: () => 42, // seed 42 makes the second seat (Bob) move first in "race"
    ...(botTurns && { botTurns }),
  });
  return { rooms, published, changes, accessor };
}

const createRace = (rooms, host = ALICE, now = T0) =>
  rooms.createRoom({ network: "net-a", host, gameId: "race", options: { target: 3 }, now });

/** A started race game: Alice hosts, Bob joins; Bob moves first. */
async function startedGame() {
  const ctx = setup();
  const room = await createRace(ctx.rooms);
  await ctx.rooms.joinRoom({ code: room.code, player: BOB, now: T0 + 1 });
  return { ...ctx, code: room.code };
}

describe("roomComponent", () => {
  describe("createRoom", () => {
    it("lets the game judge missing options as no options at all", async () => {
      const { rooms } = setup();

      // "race" has no defaults, so it refuses; a game with defaults would apply them.
      await expect(
        rooms.createRoom({ network: "net-a", host: ALICE, gameId: "race", now: T0 }),
      ).rejects.toThrow(ValidationError);
    });

    it("creates a waiting room with the host seated", async () => {
      const { rooms } = setup();

      const room = await createRace(rooms);

      expect(room).toEqual({
        code: "ROOM22",
        gameId: "race",
        options: { target: 3 },
        status: "waiting",
        hostId: ALICE.id,
        network: "net-a",
        seats: [{ playerId: ALICE.id, displayName: "Alice", connected: true, away: false, since: T0 }],
        createdAt: T0,
        lastActivityAt: T0,
        dueAt: 0,
        expiresAt: T0 + ROOM_LIFETIMES.waitingMs,
        version: 1,
      });
      expect(Object.isFrozen(room.seats[0])).toBe(true);
    });

    it("marks a room quick match made, and no other room (CC-051), and never shows the mark in a view", async () => {
      const { rooms } = setup();

      const room = await rooms.createRoom({
        network: "net-a",
        host: ALICE,
        gameId: "race",
        options: { target: 3 },
        now: T0,
        quickMatch: true,
      });

      expect(room.quickMatch).toBe(true);
      expect(rooms.viewFor(room, ALICE.id)).not.toHaveProperty("quickMatch");
      expect(await createRace(rooms)).not.toHaveProperty("quickMatch");
    });

    it.each([["chess"], ["unknown"], [undefined], [42]])(
      "rejects an unavailable game (%o)",
      async (gameId) => {
        const { rooms } = setup();

        await expect(
          rooms.createRoom({ network: "net-a", host: ALICE, gameId, options: {}, now: T0 }),
        ).rejects.toThrow(ValidationError);
      },
    );

    it("rejects options the engine refuses, with the engine's message", async () => {
      const { rooms } = setup();

      await expect(
        rooms.createRoom({ network: "net-a", host: ALICE, gameId: "race", options: { target: 99 }, now: T0 }),
      ).rejects.toThrow(/target must be an integer/);
    });

    it("retries when a generated code is already taken", async () => {
      const { rooms } = setup({ codes: ["ROOM22", "ROOM22", "ROOM33"] });

      await createRace(rooms);
      const second = await createRace(rooms, BOB);

      expect(second.code).toBe("ROOM33");
    });

    it("gives up loudly when no free code can be found", async () => {
      const { rooms } = setup({ codes: Array(11).fill("ROOM22") });
      await createRace(rooms);

      await expect(createRace(rooms, BOB)).rejects.toThrow(/Could not find a free room code/);
    });
  });

  describe("joinRoom", () => {
    it("starts the game once the room is full, seeding the engine", async () => {
      const { rooms } = setup();
      const { code } = await createRace(rooms);

      const room = await rooms.joinRoom({ code, player: BOB, now: T0 + 5 });

      expect(room.status).toBe("playing");
      expect(room.seats.map((s) => s.playerId)).toEqual([ALICE.id, BOB.id]);
      expect(room.game.seed).toBe(42);
      expect(room.game.state).toEqual(expect.objectContaining({ count: 0, players: [ALICE.id, BOB.id] }));
      expect(room.lastActivityAt).toBe(T0 + 5);
    });

    it("lets a seated player rejoin (e.g. after a reconnect) without taking a second seat", async () => {
      const { rooms, code } = await startedGame();
      await rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 10 });

      const room = await rooms.joinRoom({ code, player: BOB, now: T0 + 20 });

      expect(room.seats).toHaveLength(2);
      expect(room.seats[1]).toEqual(expect.objectContaining({ playerId: BOB.id, connected: true }));
    });

    it("refuses a stranger once the game has started", async () => {
      const { rooms, code } = await startedGame();

      await expect(rooms.joinRoom({ code, player: CAROL, now: T0 + 2 })).rejects.toThrow(ConflictError);
    });

    it("refuses unknown rooms", async () => {
      const { rooms } = setup();

      await expect(rooms.joinRoom({ code: "NOPE22", player: BOB, now: T0 })).rejects.toThrow(NotFoundError);
    });
  });

  describe("makeMove", () => {
    it("applies legal moves through the engine", async () => {
      const { rooms, code } = await startedGame();

      const room = await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 3 });

      expect(room.game.state.count).toBe(1);
      expect(room.lastActivityAt).toBe(T0 + 3);
    });

    it("turns an engine rejection into a ValidationError carrying the reason", async () => {
      const { rooms, code } = await startedGame();

      let thrown;
      try {
        await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 3 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ValidationError);
      expect(thrown.details).toEqual({ reason: "NOT_YOUR_TURN" });
    });

    it("finishes the room and publishes the result when the game ends", async () => {
      const { rooms, code, published } = await startedGame();
      await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 3 });

      const room = await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 4 });

      const outcome = { status: "finished", result: "win", winners: [ALICE.id], reason: "reached-target" };
      expect(room.status).toBe("finished");
      expect(room.result).toEqual(outcome);
      expect(published).toEqual([
        { event: ROOM_EVENTS.GAME_FINISHED, payload: { room: expect.any(Object), outcome } },
      ]);
    });

    it("refuses moves from someone not in the room", async () => {
      const { rooms, code } = await startedGame();

      await expect(rooms.makeMove({ code, playerId: CAROL.id, move: { add: 1 }, now: T0 })).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("refuses moves before the game starts", async () => {
      const { rooms } = setup();
      const { code } = await createRace(rooms);

      await expect(rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 })).rejects.toThrow(
        /not started/,
      );
    });

    it("refuses moves after the game ends", async () => {
      const { rooms, code } = await startedGame();
      await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 2 });

      await expect(
        rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 3 }),
      ).rejects.toThrow(/game is over/);
    });
  });

  describe("leaveRoom", () => {
    it("forfeits a game in progress: everyone else wins", async () => {
      const { rooms, code, published } = await startedGame();

      const { room } = await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 9 });

      const outcome = { status: "finished", result: "win", winners: [ALICE.id], reason: "forfeit" };
      expect(room.status).toBe("finished");
      expect(room.result).toEqual(outcome);
      expect(room.seats.find((s) => s.playerId === BOB.id).connected).toBe(false);
      expect(published.at(-1)).toEqual({
        event: ROOM_EVENTS.GAME_FINISHED,
        payload: { room: expect.any(Object), outcome },
      });
    });

    it("hands the host role to the next player when the host leaves a waiting room", async () => {
      const { rooms } = setup({ engines: [partyEngine] });
      const { code } = await rooms.createRoom({
        network: "net-a",
        host: ALICE,
        gameId: "party",
        options: { target: 3 },
        now: T0,
      });
      await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });

      const { room } = await rooms.leaveRoom({ code, playerId: ALICE.id, now: T0 + 2 });

      expect(room.hostId).toBe(BOB.id);
      expect(room.seats.map((s) => s.playerId)).toEqual([BOB.id]);
      expect(room.status).toBe("waiting");
    });

    it("keeps the host when another player leaves a waiting room", async () => {
      const { rooms } = setup({ engines: [partyEngine] });
      const { code } = await rooms.createRoom({
        network: "net-a",
        host: ALICE,
        gameId: "party",
        options: { target: 3 },
        now: T0,
      });
      await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });

      const { room } = await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 2 });

      expect(room.hostId).toBe(ALICE.id);
      expect(room.seats.map((s) => s.playerId)).toEqual([ALICE.id]);
    });

    it("closes and announces a room when the last player leaves", async () => {
      const { rooms, published } = setup();
      const { code } = await createRace(rooms);

      const result = await rooms.leaveRoom({ code, playerId: ALICE.id, now: T0 + 1 });

      expect(result).toEqual({ closed: true });
      expect(published).toEqual([{ event: ROOM_EVENTS.CLOSED, payload: { code, reason: "empty" } }]);
      await expect(rooms.getRoom(code)).rejects.toThrow(GoneError);
    });

    it("refuses to let a non-member leave", async () => {
      const { rooms, code } = await startedGame();

      await expect(rooms.leaveRoom({ code, playerId: CAROL.id, now: T0 })).rejects.toThrow(ForbiddenError);
    });
  });

  describe("giveUpWaitingSeats (a player signs out, CC-085)", () => {
    it("closes a waiting room they were alone in", async () => {
      const { rooms, published } = setup();
      const { code } = await createRace(rooms);

      expect(await rooms.giveUpWaitingSeats({ playerId: ALICE.id, now: T0 + 1 })).toEqual([]);
      expect(published).toContainEqual({ event: ROOM_EVENTS.CLOSED, payload: { code, reason: "empty" } });
    });

    it("frees their seat in a shared waiting room and passes the host role on", async () => {
      const { rooms } = setup({ engines: [partyEngine] });
      const { code } = await rooms.createRoom({
        network: "net-a",
        host: ALICE,
        gameId: "party",
        options: { target: 3 },
        now: T0,
      });
      await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });

      const [room] = await rooms.giveUpWaitingSeats({ playerId: ALICE.id, now: T0 + 2 });

      expect(room.seats.map((seat) => seat.playerId)).toEqual([BOB.id]);
      expect(room.hostId).toBe(BOB.id);
    });

    it("keeps their seat in a running game, and touches no one else's rooms", async () => {
      const { rooms, code } = await startedGame();
      const other = await createRace(rooms, CAROL);

      expect(await rooms.giveUpWaitingSeats({ playerId: ALICE.id, now: T0 + 2 })).toEqual([]);
      expect((await rooms.getRoom(code)).seats.map((seat) => seat.playerId)).toContain(ALICE.id);
      expect((await rooms.getRoom(other.code)).seats).toHaveLength(1);
    });
  });

  describe("transferPlayer (a guest signs in, CC-083)", () => {
    const RIYA = Object.freeze({ kind: "user", id: "user_r", displayName: "Riya" });

    it("hands a waiting room's seat and host role to the account", async () => {
      const { rooms } = setup();
      const { code } = await createRace(rooms);

      const [moved] = await rooms.transferPlayer({ from: ALICE.id, to: RIYA, now: T0 + 5 });

      expect(moved.seats).toEqual([{ playerId: RIYA.id, displayName: "Riya", connected: false }]);
      expect(moved.hostId).toBe(RIYA.id);
      // When the friend joins, the game is between the account and the friend, not against the old guest seat.
      // It starts once the account's own connection joins the room (CC-112).
      await rooms.joinRoom({ code, player: BOB, now: T0 + 6 });
      const started = await rooms.joinRoom({ code, player: RIYA, now: T0 + 7 });
      expect([...started.game.state.players].sort()).toEqual([BOB.id, RIYA.id].sort());
    });

    it("keeps a running game going under the account's id", async () => {
      const { rooms, code } = await startedGame();
      await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });

      await rooms.transferPlayer({ from: ALICE.id, to: RIYA, now: T0 + 3 });

      const room = await rooms.makeMove({ code, playerId: RIYA.id, move: { add: 2 }, now: T0 + 4 });
      expect(room.game.log.map((entry) => entry.playerId)).toEqual([BOB.id, RIYA.id]);
      await expect(
        rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 5 }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("gives the guest seat up when the account already sits in that waiting room", async () => {
      const { rooms } = setup({ engines: [partyEngine] });
      const { code } = await rooms.createRoom({
        network: "net-a",
        host: ALICE,
        gameId: "party",
        options: { target: 3 },
        now: T0,
      });
      await rooms.joinRoom({ code, player: RIYA, now: T0 + 1 });

      const [room] = await rooms.transferPlayer({ from: ALICE.id, to: RIYA, now: T0 + 2 });

      expect(room.seats.map((seat) => seat.playerId)).toEqual([RIYA.id]);
    });

    it("keeps the host role where it was when the guest was not the host", async () => {
      const { rooms } = setup({ engines: [partyEngine] });
      const { code } = await rooms.createRoom({
        network: "net-a",
        host: ALICE,
        gameId: "party",
        options: { target: 3 },
        now: T0,
      });
      await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });

      const [room] = await rooms.transferPlayer({ from: BOB.id, to: RIYA, now: T0 + 2 });

      expect(room.hostId).toBe(ALICE.id);
      expect(room.seats.map((s) => s.playerId)).toEqual([ALICE.id, RIYA.id]);
    });

    it("leaves a running game alone when the account already plays in it", async () => {
      const { rooms } = setup();
      const { code } = await createRace(rooms);
      await rooms.joinRoom({ code, player: RIYA, now: T0 + 1 }); // Alice (guest) vs Riya (account): playing

      expect(await rooms.transferPlayer({ from: ALICE.id, to: RIYA, now: T0 + 2 })).toEqual([]);
      expect((await rooms.getRoom(code)).seats.map((s) => s.playerId)).toEqual([ALICE.id, RIYA.id]);
    });

    it("hands a finished game's seat, result and rematch to the account, and leaves other rooms alone (CC-097)", async () => {
      const { rooms, code } = await startedGame();
      await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
      await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 3 }); // Alice reaches 3: finished
      await rooms.askRequest({ code, playerId: ALICE.id, type: "rematch", now: T0 + 4 });
      const other = await createRace(rooms, CAROL);

      const [room] = await rooms.transferPlayer({ from: ALICE.id, to: RIYA, now: T0 + 5 });

      expect(room.code).toBe(code);
      expect(room.seats.map((seat) => seat.playerId)).toContain(RIYA.id);
      expect(room.result.winners).toEqual([RIYA.id]);
      expect(room.series.wins).toEqual({ [RIYA.id]: 1 });
      expect(room.requests).toEqual([expect.objectContaining({ from: RIYA.id, to: BOB.id, state: "open" })]);
      // The account sees the result as its own win, and can play again with the same opponent.
      expect(rooms.viewFor(room, RIYA.id).game.outcome.winners).toEqual([seatOf(room, RIYA)]);
      const again = await rooms.askRequest({ code, playerId: BOB.id, type: "rematch", now: T0 + 6 });
      expect(again.status).toBe("playing");
      expect((await rooms.getRoom(other.code)).seats[0].playerId).toBe(CAROL.id);
    });

    it("leaves a finished game alone when the account already played in it", async () => {
      const { rooms } = setup();
      const { code } = await createRace(rooms);
      await rooms.joinRoom({ code, player: RIYA, now: T0 + 1 });
      await rooms.makeMove({ code, playerId: RIYA.id, move: { add: 1 }, now: T0 + 2 });
      await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 2 }); // 3 reached: finished

      expect((await rooms.getRoom(code)).status).toBe("finished");
      expect(await rooms.transferPlayer({ from: ALICE.id, to: RIYA, now: T0 + 3 })).toEqual([]);
    });
  });

  describe("disconnects", () => {
    it("keeps the seat but marks it disconnected", async () => {
      const { rooms, code } = await startedGame();

      const room = await rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 7 });

      expect(room.seats.find((s) => s.playerId === BOB.id)).toEqual(
        expect.objectContaining({ connected: false }),
      );
      expect(room.status).toBe("playing");
    });
  });

  describe("viewFor", () => {
    it("shows a waiting room without game data", async () => {
      const { rooms } = setup();
      const room = await createRace(rooms);

      expect(rooms.viewFor(room, ALICE.id)).toEqual({
        code: room.code,
        gameId: "race",
        status: "waiting",
        hostId: seatOf(room, ALICE),
        players: { min: 2, max: 2 },
        seats: [
          {
            playerId: seatOf(room, ALICE),
            displayName: "Alice",
            connected: true,
            presence: "here",
            since: T0,
            graceUntil: 0,
          },
        ],
        you: seatOf(room, ALICE),
        requests: [],
        requestsLeft: {},
        askAgainAt: {},
      });
    });

    it("includes the match id, the engine's view, whose turn it is, and the outcome once playing", async () => {
      const { rooms, code } = await startedGame();
      const room = await rooms.getRoom(code);

      const view = rooms.viewFor(room, ALICE.id);

      expect(view.game).toEqual({
        matchId: room.game.matchId,
        view: { count: 0, target: 3, toMove: seatOf(room, BOB) },
        activePlayers: [seatOf(room, BOB)],
        outcome: { status: "ongoing" },
        number: 1,
        // Bob has not made a first move yet, so the first move limit runs from the start (CC-036).
        turnEndsAt: T0 + 1 + ROOM_LIFETIMES.firstMoveMs,
      });
    });

    it("never exposes raw engine state or the seed", async () => {
      const { rooms, code } = await startedGame();

      const json = JSON.stringify(rooms.viewFor(await rooms.getRoom(code), ALICE.id));

      expect(json).not.toContain('"seed"');
      expect(json).not.toContain('"state"');
    });

    it("asks the engine for the spectator view for non-members", async () => {
      const { rooms, code } = await startedGame();
      const seen = [];
      const spying = createRoomComponent({
        seatIds: TEST_SEAT_IDS,
        roomAccessor: {},
        engines: createEngineRegistry([
          defineEngine({ ...raceEngine, viewFor: (state, viewer) => (seen.push(viewer), {}) }),
        ]),
        events: { emit() {} },
      });

      const view = spying.viewFor(await rooms.getRoom(code), CAROL.id);

      expect(view.you).toBe("");
      expect(seen).toEqual(["spectator"]);
    });

    it("reports the stored result (e.g. a forfeit) and no active players once finished", async () => {
      const { rooms, code } = await startedGame();
      const { room } = await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 2 });

      const { game } = rooms.viewFor(room, ALICE.id);

      expect(game.outcome).toEqual({
        status: "finished",
        result: "win",
        winners: [seatOf(room, ALICE)],
        reason: "forfeit",
      });
      expect(game.activePlayers).toEqual([]);
    });
  });

  it("fails fast on missing dependencies", async () => {
    expect(() => createRoomComponent({ engines: {}, events: { emit() {} } })).toThrow(TypeError);
    expect(() => createRoomComponent({ roomAccessor: {}, engines: {}, events: {} })).toThrow(TypeError);
  });

  describe("expireDue (engine time hooks)", () => {
    // A timed race variant: the player to move loses once 1 s has passed since the game started.
    const timedEngine = defineEngine({
      ...raceEngine,
      id: "timed",
      init: (setup) => ({ ...raceEngine.init(setup), deadline: T0 + 1_000 }),
      deadline: (state) => (state.winner === "" ? state.deadline : 0),
      expire: (state, { now }) =>
        now >= state.deadline ? { ...state, winner: state.players.find((p, i) => i !== state.turn) } : state,
    });

    async function timedGame() {
      const ctx = setup({ engines: [timedEngine, raceEngine] });
      const { code } = await ctx.rooms.createRoom({
        network: "net-a",
        host: ALICE,
        gameId: "timed",
        options: { target: 3 },
        now: T0,
      });
      await ctx.rooms.joinRoom({ code, player: BOB, now: T0 });
      return { ...ctx, code };
    }

    it("does nothing before the deadline", async () => {
      const { rooms, code, published } = await timedGame();

      expect(await rooms.expireDue({ now: T0 + 999 })).toEqual([]);
      expect((await rooms.getRoom(code)).status).toBe("playing");
      expect(published).toEqual([]);
    });

    it("applies the deadline, finishes the room and publishes the change", async () => {
      const { rooms, code, published } = await timedGame();

      const changed = await rooms.expireDue({ now: T0 + 1_000 });

      const room = await rooms.getRoom(code);
      expect(changed).toEqual([code]);
      expect(room.status).toBe("finished");
      expect(room.result.winners).toEqual([ALICE.id]); // Bob was to move
      expect(published.map((p) => p.event)).toEqual([ROOM_EVENTS.GAME_FINISHED, ROOM_EVENTS.UPDATED]);
    });

    it("ignores engines without time hooks and rooms that are not playing", async () => {
      const { rooms } = await timedGame();
      const race = await createRace(rooms, CAROL);

      expect(await rooms.expireDue({ now: T0 + 1_000_000 })).not.toContain(race.code);
    });

    it("applies a deadline that does not end the game, and publishes the change", async () => {
      // Each deadline skips the turn of the player to move and sets a new one; the game goes on.
      const turnTimerEngine = defineEngine({
        ...timedEngine,
        id: "turn-timer",
        deadline: (state) => state.deadline,
        expire: (state, { now }) => ({ ...state, turn: 1 - state.turn, deadline: now + 1_000 }),
      });
      const { rooms, published } = setup({ engines: [turnTimerEngine] });
      const { code } = await rooms.createRoom({
        network: "net-a",
        host: ALICE,
        gameId: "turn-timer",
        options: { target: 3 },
        now: T0,
      });
      await rooms.joinRoom({ code, player: BOB, now: T0 });

      expect(await rooms.expireDue({ now: T0 + 1_000 })).toEqual([code]);

      const room = await rooms.getRoom(code);
      expect(room.status).toBe("playing");
      expect(room.game.log).toEqual([{ kind: "expire", at: T0 + 1_000 }]);
      expect(published.map((p) => p.event)).toEqual([ROOM_EVENTS.UPDATED]);
    });

    it("applies a deadline only once", async () => {
      const { rooms } = await timedGame();
      await rooms.expireDue({ now: T0 + 1_000 });

      expect(await rooms.expireDue({ now: T0 + 2_000 })).toEqual([]);
    });
  });

  describe("action log (for match history and replays)", () => {
    it("starts a game with a match id, start time, seed and empty log", async () => {
      const { rooms, code } = await startedGame();

      expect((await rooms.getRoom(code)).game).toEqual(
        expect.objectContaining({
          seed: 42,
          startedAt: T0 + 1,
          log: [],
          matchId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      );
    });

    it("logs every accepted move with the server time and the validated move", async () => {
      const { rooms, code } = await startedGame();

      await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1, extra: "ignored" }, now: T0 + 5 });

      expect((await rooms.getRoom(code)).game.log).toEqual([
        { kind: "move", playerId: BOB.id, move: { add: 1 }, at: T0 + 5 },
      ]);
    });

    it("does not log rejected moves", async () => {
      const { rooms, code } = await startedGame();

      await expect(
        rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 5 }),
      ).rejects.toThrow();
      expect((await rooms.getRoom(code)).game.log).toEqual([]);
    });

    it("logs a forfeit", async () => {
      const { rooms, code } = await startedGame();

      const { room } = await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 6 });

      expect(room.game.log).toEqual([{ kind: "forfeit", playerId: BOB.id, at: T0 + 6 }]);
    });

    it("never exposes the log in a player's view", async () => {
      const { rooms, code } = await startedGame();
      await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 5 });

      expect(JSON.stringify(rooms.viewFor(await rooms.getRoom(code), ALICE.id))).not.toContain('"log"');
    });
  });

  describe("two changes at the same moment (CC-101)", () => {
    it("decides again on the latest room when someone else saved first, so no update is lost", async () => {
      let interfere = async () => {};
      const ctx = setup({
        engines: [partyEngine],
        wrap: (accessor) => ({
          ...accessor,
          async save(change) {
            const before = interfere;
            interfere = async () => {};
            await before();
            return accessor.save(change);
          },
        }),
      });
      const { code } = await ctx.rooms.createRoom({
        network: "net-a",
        host: ALICE,
        gameId: "party",
        options: { target: 3 },
        now: T0,
      });
      // Carol's join is saved between Bob's read and Bob's save.
      interfere = () => ctx.rooms.joinRoom({ code, player: CAROL, now: T0 + 1 });

      const room = await ctx.rooms.joinRoom({ code, player: BOB, now: T0 + 2 });

      expect(room.seats.map((seat) => seat.playerId)).toEqual([ALICE.id, CAROL.id, BOB.id]);
      expect(room.version).toBe(3);
    });

    it("gives up after a few attempts when the room keeps changing", async () => {
      let saves = 0;
      // Every save is beaten by another one of the same version.
      const { rooms } = setup({
        wrap: (accessor) => ({
          ...accessor,
          async save(change) {
            saves++;
            await accessor.save(change);
            return accessor.save(change);
          },
        }),
      });
      const { code } = await createRace(rooms);

      await expect(rooms.joinRoom({ code, player: BOB, now: T0 + 1 })).rejects.toThrow(ConcurrentChangeError);
      expect(saves).toBe(5);
    });

    it("tries the next code when another room took the same code a moment ago", async () => {
      let first = true;
      const { rooms } = setup({
        wrap: (accessor) => ({
          ...accessor,
          async create(room) {
            if (first) {
              first = false;
              await accessor.create(room);
            }
            return accessor.create(room);
          },
        }),
      });

      const room = await createRace(rooms);

      expect(room.code).toBe("ROOM33");
    });

    it("passes other storage failures on when creating", async () => {
      const failure = new Error("disk on fire");
      const { rooms } = setup({
        wrap: (accessor) => ({
          ...accessor,
          create: async () => {
            throw failure;
          },
        }),
      });

      await expect(createRace(rooms)).rejects.toThrow(failure);
    });

    it("passes other storage failures on when reading", async () => {
      const failure = new Error("disk on fire");
      const { rooms } = setup({
        wrap: (accessor) => ({
          ...accessor,
          getByCode: async () => {
            throw failure;
          },
        }),
      });

      await expect(rooms.joinRoom({ code: "ROOM22", player: BOB, now: T0 })).rejects.toThrow(failure);
    });
  });

  describe("closed rooms say why (CC-101)", () => {
    it("answers a closed room with GoneError carrying the reason, the game and when", async () => {
      const { rooms } = setup();
      const { code } = await createRace(rooms);
      await rooms.leaveRoom({ code, playerId: ALICE.id, now: T0 + 1 });

      const error = await rooms.joinRoom({ code, player: BOB, now: T0 + 2 }).catch((err) => err);

      expect(error).toBeInstanceOf(GoneError);
      expect(error.details).toEqual({ reason: "empty", gameId: "race", closedAt: T0 + 1 });
    });

    it("never gives a recently closed code to a new room", async () => {
      const { rooms } = setup({ codes: ["ROOM22", "ROOM22", "ROOM33"] });
      await rooms.leaveRoom({ code: (await createRace(rooms)).code, playerId: ALICE.id, now: T0 + 1 });

      const room = await createRace(rooms, BOB, T0 + 2);

      expect(room.code).toBe("ROOM33");
    });

    it("skips rooms that closed between being listed and being changed", async () => {
      let stale = [];
      const { rooms } = setup({
        wrap: (accessor) => ({ ...accessor, listBySeat: async () => stale }),
      });
      const room = await createRace(rooms);
      stale = [room];
      await rooms.leaveRoom({ code: room.code, playerId: ALICE.id, now: T0 + 1 });

      expect(await rooms.giveUpWaitingSeats({ playerId: ALICE.id, now: T0 + 2 })).toEqual([]);
    });

    it("stops bulk work on a storage failure instead of hiding it", async () => {
      const failure = new Error("disk on fire");
      const { rooms } = setup({
        wrap: (accessor) => ({
          ...accessor,
          listBySeat: async () => [{ code: "ROOM22" }],
          getByCode: async () => {
            throw failure;
          },
        }),
      });

      await expect(rooms.transferPlayer({ from: ALICE.id, to: CAROL, now: T0 })).rejects.toThrow(failure);
    });
  });

  describe("markEveryoneAway (after a restart, CC-101)", () => {
    it("shows every seat as disconnected and keeps the time of the last activity", async () => {
      const { rooms, code } = await startedGame();
      const waiting = await createRace(rooms, CAROL, T0 + 2);

      const changed = await rooms.markEveryoneAway({ now: T0 + 3 });

      expect(changed.sort()).toEqual([code, waiting.code].sort());
      const room = await rooms.getRoom(code);
      expect(room.seats.map((seat) => seat.connected)).toEqual([false, false]);
      expect(room.lastActivityAt).toBe(T0 + 1);
    });

    it("changes nothing in a waiting room when nobody was shown as connected", async () => {
      const { rooms } = setup();
      const waiting = await createRace(rooms, CAROL, T0);
      await rooms.markEveryoneAway({ now: T0 + 2 });

      expect(await rooms.markEveryoneAway({ now: T0 + 3 })).toEqual([]);
      expect((await rooms.getRoom(waiting.code)).version).toBe(2);
    });

    it("resumes every game in progress, even when nobody was shown as connected (PR #67 review)", async () => {
      const { rooms, code } = await startedGame();
      await rooms.markEveryoneAway({ now: T0 + 2 });

      expect(await rooms.markEveryoneAway({ now: T0 + 3 })).toEqual([code]);
      const room = await rooms.getRoom(code);
      expect(room.game.resumedAt).toBe(T0 + 3);
      expect(room.seats.map((seat) => seat.since)).toEqual([T0 + 2, T0 + 2]);
    });
  });
});
