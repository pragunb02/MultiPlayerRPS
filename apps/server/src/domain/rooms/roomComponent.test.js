import { describe, expect, it } from "vitest";
import { createEngineRegistry, defineEngine } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../persistence/inMemoryRoomDao.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { createRoomComponent, ROOM_EVENTS, ROOM_TTL_MS } from "./roomComponent.js";

const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const CAROL = Object.freeze({ kind: "guest", id: "guest_c", displayName: "Carol" });
const T0 = 1_000_000;

/** Room component over the real accessor + in-memory DAO, with the reference "race" engine. */
// A 4-seat variant, so a waiting room can hold several players before it starts.
const partyEngine = defineEngine({ ...raceEngine, id: "party", players: { min: 2, max: 4 } });

function setup({ codes = ["ROOM22", "ROOM33", "ROOM44"], engines = [raceEngine] } = {}) {
  const published = [];
  const queue = [...codes];
  const rooms = createRoomComponent({
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry(engines),
    events: { emit: (event, payload) => published.push({ event, payload }) },
    generateCode: () => queue.shift(),
    generateSeed: () => 42, // seed 42 makes the second seat (Bob) move first in "race"
  });
  return { rooms, published };
}

const createRace = (rooms, host = ALICE, now = T0) =>
  rooms.createRoom({ host, gameId: "race", options: { target: 3 }, now });

/** A started race game: Alice hosts, Bob joins; Bob moves first. */
function startedGame() {
  const ctx = setup();
  const room = createRace(ctx.rooms);
  ctx.rooms.joinRoom({ code: room.code, player: BOB, now: T0 + 1 });
  return { ...ctx, code: room.code };
}

describe("roomComponent", () => {
  describe("createRoom", () => {
    it("creates a waiting room with the host seated", () => {
      const { rooms } = setup();

      const room = createRace(rooms);

      expect(room).toEqual({
        code: "ROOM22",
        gameId: "race",
        options: { target: 3 },
        status: "waiting",
        hostId: ALICE.id,
        seats: [{ playerId: ALICE.id, displayName: "Alice", connected: true }],
        createdAt: T0,
        lastActivityAt: T0,
        version: 1,
      });
      expect(Object.isFrozen(room.seats[0])).toBe(true);
    });

    it.each([["chess"], ["unknown"], [undefined], [42]])("rejects an unavailable game (%o)", (gameId) => {
      const { rooms } = setup();

      expect(() => rooms.createRoom({ host: ALICE, gameId, options: {}, now: T0 })).toThrow(ValidationError);
    });

    it("rejects options the engine refuses, with the engine's message", () => {
      const { rooms } = setup();

      expect(() =>
        rooms.createRoom({ host: ALICE, gameId: "race", options: { target: 99 }, now: T0 }),
      ).toThrow(/target must be an integer/);
    });

    it("retries when a generated code is already taken", () => {
      const { rooms } = setup({ codes: ["ROOM22", "ROOM22", "ROOM33"] });

      createRace(rooms);
      const second = createRace(rooms, BOB);

      expect(second.code).toBe("ROOM33");
    });

    it("gives up loudly when no free code can be found", () => {
      const { rooms } = setup({ codes: Array(11).fill("ROOM22") });
      createRace(rooms);

      expect(() => createRace(rooms, BOB)).toThrow(/Could not find a free room code/);
    });
  });

  describe("joinRoom", () => {
    it("starts the game once the room is full, seeding the engine", () => {
      const { rooms } = setup();
      const { code } = createRace(rooms);

      const room = rooms.joinRoom({ code, player: BOB, now: T0 + 5 });

      expect(room.status).toBe("playing");
      expect(room.seats.map((s) => s.playerId)).toEqual([ALICE.id, BOB.id]);
      expect(room.game.seed).toBe(42);
      expect(room.game.state).toEqual(expect.objectContaining({ count: 0, players: [ALICE.id, BOB.id] }));
      expect(room.lastActivityAt).toBe(T0 + 5);
    });

    it("lets a seated player rejoin (e.g. after a reconnect) without taking a second seat", () => {
      const { rooms, code } = startedGame();
      rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 10 });

      const room = rooms.joinRoom({ code, player: BOB, now: T0 + 20 });

      expect(room.seats).toHaveLength(2);
      expect(room.seats[1]).toEqual(expect.objectContaining({ playerId: BOB.id, connected: true }));
    });

    it("refuses a stranger once the game has started", () => {
      const { rooms, code } = startedGame();

      expect(() => rooms.joinRoom({ code, player: CAROL, now: T0 + 2 })).toThrow(ConflictError);
    });

    it("refuses unknown rooms", () => {
      const { rooms } = setup();

      expect(() => rooms.joinRoom({ code: "NOPE22", player: BOB, now: T0 })).toThrow(NotFoundError);
    });
  });

  describe("makeMove", () => {
    it("applies legal moves through the engine", () => {
      const { rooms, code } = startedGame();

      const room = rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 3 });

      expect(room.game.state.count).toBe(1);
      expect(room.lastActivityAt).toBe(T0 + 3);
    });

    it("turns an engine rejection into a ValidationError carrying the reason", () => {
      const { rooms, code } = startedGame();

      let thrown;
      try {
        rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 3 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ValidationError);
      expect(thrown.details).toEqual({ reason: "NOT_YOUR_TURN" });
    });

    it("finishes the room and publishes the result when the game ends", () => {
      const { rooms, code, published } = startedGame();
      rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 3 });

      const room = rooms.makeMove({ code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 4 });

      const outcome = { status: "finished", result: "win", winners: [ALICE.id], reason: "reached-target" };
      expect(room.status).toBe("finished");
      expect(room.result).toEqual(outcome);
      expect(published).toEqual([
        { event: ROOM_EVENTS.GAME_FINISHED, payload: { room: expect.any(Object), outcome } },
      ]);
    });

    it("refuses moves from someone not in the room", () => {
      const { rooms, code } = startedGame();

      expect(() => rooms.makeMove({ code, playerId: CAROL.id, move: { add: 1 }, now: T0 })).toThrow(
        ForbiddenError,
      );
    });

    it("refuses moves before the game starts", () => {
      const { rooms } = setup();
      const { code } = createRace(rooms);

      expect(() => rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 })).toThrow(
        /not started/,
      );
    });

    it("refuses moves after the game ends", () => {
      const { rooms, code } = startedGame();
      rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 2 });

      expect(() => rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 3 })).toThrow(
        /game is over/,
      );
    });
  });

  describe("leaveRoom", () => {
    it("forfeits a game in progress: everyone else wins", () => {
      const { rooms, code, published } = startedGame();

      const { room } = rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 9 });

      const outcome = { status: "finished", result: "win", winners: [ALICE.id], reason: "forfeit" };
      expect(room.status).toBe("finished");
      expect(room.result).toEqual(outcome);
      expect(room.seats.find((s) => s.playerId === BOB.id).connected).toBe(false);
      expect(published.at(-1)).toEqual({
        event: ROOM_EVENTS.GAME_FINISHED,
        payload: { room: expect.any(Object), outcome },
      });
    });

    it("hands the host role to the next player when the host leaves a waiting room", () => {
      const { rooms } = setup({ engines: [partyEngine] });
      const { code } = rooms.createRoom({ host: ALICE, gameId: "party", options: { target: 3 }, now: T0 });
      rooms.joinRoom({ code, player: BOB, now: T0 + 1 });

      const { room } = rooms.leaveRoom({ code, playerId: ALICE.id, now: T0 + 2 });

      expect(room.hostId).toBe(BOB.id);
      expect(room.seats.map((s) => s.playerId)).toEqual([BOB.id]);
      expect(room.status).toBe("waiting");
    });

    it("closes and announces a room when the last player leaves", () => {
      const { rooms, published } = setup();
      const { code } = createRace(rooms);

      const result = rooms.leaveRoom({ code, playerId: ALICE.id, now: T0 + 1 });

      expect(result).toEqual({ closed: true });
      expect(published).toEqual([{ event: ROOM_EVENTS.CLOSED, payload: { code, reason: "empty" } }]);
      expect(() => rooms.getRoom(code)).toThrow(NotFoundError);
    });

    it("refuses to let a non-member leave", () => {
      const { rooms, code } = startedGame();

      expect(() => rooms.leaveRoom({ code, playerId: CAROL.id, now: T0 })).toThrow(ForbiddenError);
    });
  });

  describe("transferPlayer (a guest signs in, CC-083)", () => {
    const RIYA = Object.freeze({ kind: "user", id: "user_r", displayName: "Riya" });

    it("hands a waiting room's seat and host role to the account", () => {
      const { rooms } = setup();
      const { code } = createRace(rooms);

      const [moved] = rooms.transferPlayer({ from: ALICE.id, to: RIYA, now: T0 + 5 });

      expect(moved.seats).toEqual([{ playerId: RIYA.id, displayName: "Riya", connected: false }]);
      expect(moved.hostId).toBe(RIYA.id);
      // When the friend joins, the game is between the account and the friend — not against the old guest seat.
      const started = rooms.joinRoom({ code, player: BOB, now: T0 + 6 });
      expect([...started.game.state.players].sort()).toEqual([BOB.id, RIYA.id].sort());
    });

    it("keeps a running game going under the account's id", () => {
      const { rooms, code } = startedGame();
      rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });

      rooms.transferPlayer({ from: ALICE.id, to: RIYA, now: T0 + 3 });

      const room = rooms.makeMove({ code, playerId: RIYA.id, move: { add: 2 }, now: T0 + 4 });
      expect(room.game.log.map((entry) => entry.playerId)).toEqual([BOB.id, RIYA.id]);
      expect(() => rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 5 })).toThrow(
        ForbiddenError,
      );
    });

    it("gives the guest seat up when the account already sits in that waiting room", () => {
      const { rooms } = setup({ engines: [partyEngine] });
      const { code } = rooms.createRoom({ host: ALICE, gameId: "party", options: { target: 3 }, now: T0 });
      rooms.joinRoom({ code, player: RIYA, now: T0 + 1 });

      const [room] = rooms.transferPlayer({ from: ALICE.id, to: RIYA, now: T0 + 2 });

      expect(room.seats.map((seat) => seat.playerId)).toEqual([RIYA.id]);
    });

    it("leaves finished games and other players' rooms alone", () => {
      const { rooms, code } = startedGame();
      rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
      rooms.makeMove({ code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 3 }); // Alice reaches 3: finished
      const other = createRace(rooms, CAROL);

      expect(rooms.transferPlayer({ from: ALICE.id, to: RIYA, now: T0 + 3 })).toEqual([]);
      expect(rooms.getRoom(other.code).seats[0].playerId).toBe(CAROL.id);
    });
  });

  describe("disconnects", () => {
    it("keeps the seat but marks it disconnected", () => {
      const { rooms, code } = startedGame();

      const room = rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 7 });

      expect(room.seats.find((s) => s.playerId === BOB.id)).toEqual(
        expect.objectContaining({ connected: false }),
      );
      expect(room.status).toBe("playing");
    });
  });

  describe("sweepExpired", () => {
    it("closes waiting rooms idle past their TTL, and only those", () => {
      const { rooms, published } = setup();
      const stale = createRace(rooms, ALICE, T0);
      const fresh = createRace(rooms, BOB, T0 + ROOM_TTL_MS.waiting);

      const closed = rooms.sweepExpired({ now: T0 + ROOM_TTL_MS.waiting });

      expect(closed).toEqual([stale.code]);
      expect(published).toEqual([
        { event: ROOM_EVENTS.CLOSED, payload: { code: stale.code, reason: "expired" } },
      ]);
      expect(rooms.getRoom(fresh.code).code).toBe(fresh.code);
    });

    it("closes finished rooms after their (shorter) TTL", () => {
      const { rooms, code } = startedGame();
      rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 2 });

      expect(rooms.sweepExpired({ now: T0 + 2 + ROOM_TTL_MS.finished - 1 })).toEqual([]);
      expect(rooms.sweepExpired({ now: T0 + 2 + ROOM_TTL_MS.finished })).toEqual([code]);
    });

    it("closes games where every player has disconnected", () => {
      const { rooms, code, published } = startedGame();
      rooms.playerDisconnected({ code, playerId: ALICE.id, now: T0 + 2 });
      rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 3 });

      expect(rooms.sweepExpired({ now: T0 + 3 + ROOM_TTL_MS.abandoned })).toEqual([code]);
      expect(published.at(-1)).toEqual({ event: ROOM_EVENTS.CLOSED, payload: { code, reason: "abandoned" } });
    });

    it("never closes a game in progress while someone is connected", () => {
      const { rooms, code } = startedGame();
      rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 2 });

      expect(rooms.sweepExpired({ now: T0 + 24 * 60 * 60 * 1000 })).toEqual([]);
    });
  });

  describe("viewFor", () => {
    it("shows a waiting room without game data", () => {
      const { rooms } = setup();
      const room = createRace(rooms);

      expect(rooms.viewFor(room, ALICE.id)).toEqual({
        code: room.code,
        gameId: "race",
        status: "waiting",
        hostId: ALICE.id,
        players: { min: 2, max: 2 },
        seats: [{ playerId: ALICE.id, displayName: "Alice", connected: true }],
        you: ALICE.id,
      });
    });

    it("includes the engine's view, whose turn it is, and the outcome once playing", () => {
      const { rooms, code } = startedGame();

      const view = rooms.viewFor(rooms.getRoom(code), ALICE.id);

      expect(view.game).toEqual({
        view: { count: 0, target: 3, toMove: BOB.id },
        activePlayers: [BOB.id],
        outcome: { status: "ongoing" },
      });
    });

    it("never exposes raw engine state or the seed", () => {
      const { rooms, code } = startedGame();

      const json = JSON.stringify(rooms.viewFor(rooms.getRoom(code), ALICE.id));

      expect(json).not.toContain('"seed"');
      expect(json).not.toContain('"state"');
    });

    it("asks the engine for the spectator view for non-members", () => {
      const { rooms, code } = startedGame();
      const seen = [];
      const spying = createRoomComponent({
        roomAccessor: { getByCode: () => rooms.getRoom(code), exists: () => true },
        engines: createEngineRegistry([
          defineEngine({ ...raceEngine, viewFor: (state, viewer) => (seen.push(viewer), {}) }),
        ]),
        events: { emit() {} },
      });

      const view = spying.viewFor(rooms.getRoom(code), CAROL.id);

      expect(view.you).toBe("");
      expect(seen).toEqual(["spectator"]);
    });

    it("reports the stored result (e.g. a forfeit) and no active players once finished", () => {
      const { rooms, code } = startedGame();
      const { room } = rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 2 });

      const { game } = rooms.viewFor(room, ALICE.id);

      expect(game.outcome).toEqual({
        status: "finished",
        result: "win",
        winners: [ALICE.id],
        reason: "forfeit",
      });
      expect(game.activePlayers).toEqual([]);
    });
  });

  it("fails fast on missing dependencies", () => {
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

    function timedGame() {
      const ctx = setup({ engines: [timedEngine, raceEngine] });
      const { code } = ctx.rooms.createRoom({
        host: ALICE,
        gameId: "timed",
        options: { target: 3 },
        now: T0,
      });
      ctx.rooms.joinRoom({ code, player: BOB, now: T0 });
      return { ...ctx, code };
    }

    it("does nothing before the deadline", () => {
      const { rooms, code, published } = timedGame();

      expect(rooms.expireDue({ now: T0 + 999 })).toEqual([]);
      expect(rooms.getRoom(code).status).toBe("playing");
      expect(published).toEqual([]);
    });

    it("applies the deadline, finishes the room and publishes the change", () => {
      const { rooms, code, published } = timedGame();

      const changed = rooms.expireDue({ now: T0 + 1_000 });

      const room = rooms.getRoom(code);
      expect(changed).toEqual([code]);
      expect(room.status).toBe("finished");
      expect(room.result.winners).toEqual([ALICE.id]); // Bob was to move
      expect(published.map((p) => p.event)).toEqual([ROOM_EVENTS.GAME_FINISHED, ROOM_EVENTS.UPDATED]);
    });

    it("ignores engines without time hooks and rooms that are not playing", () => {
      const { rooms } = timedGame();
      const race = createRace(rooms, CAROL);

      expect(rooms.expireDue({ now: T0 + 1_000_000 })).not.toContain(race.code);
    });

    it("applies a deadline only once", () => {
      const { rooms } = timedGame();
      rooms.expireDue({ now: T0 + 1_000 });

      expect(rooms.expireDue({ now: T0 + 2_000 })).toEqual([]);
    });
  });

  describe("action log (for match history and replays)", () => {
    it("starts a game with a match id, start time, seed and empty log", () => {
      const { rooms, code } = startedGame();

      expect(rooms.getRoom(code).game).toEqual(
        expect.objectContaining({
          seed: 42,
          startedAt: T0 + 1,
          log: [],
          matchId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      );
    });

    it("logs every accepted move with the server time and the validated move", () => {
      const { rooms, code } = startedGame();

      rooms.makeMove({ code, playerId: BOB.id, move: { add: 1, extra: "ignored" }, now: T0 + 5 });

      expect(rooms.getRoom(code).game.log).toEqual([
        { kind: "move", playerId: BOB.id, move: { add: 1 }, at: T0 + 5 },
      ]);
    });

    it("does not log rejected moves", () => {
      const { rooms, code } = startedGame();

      expect(() => rooms.makeMove({ code, playerId: ALICE.id, move: { add: 1 }, now: T0 + 5 })).toThrow();
      expect(rooms.getRoom(code).game.log).toEqual([]);
    });

    it("logs a forfeit", () => {
      const { rooms, code } = startedGame();

      const { room } = rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 6 });

      expect(room.game.log).toEqual([{ kind: "forfeit", playerId: BOB.id, at: T0 + 6 }]);
    });

    it("never exposes the log in a player's view", () => {
      const { rooms, code } = startedGame();
      rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 5 });

      expect(JSON.stringify(rooms.viewFor(rooms.getRoom(code), ALICE.id))).not.toContain('"log"');
    });
  });
});
