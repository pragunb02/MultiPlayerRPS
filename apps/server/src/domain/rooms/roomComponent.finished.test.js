import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { createRoomComponent, ROOM_EVENTS } from "./roomComponent.js";
import { ROOM_LIFETIMES } from "./roomLifetimes.js";

const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const T0 = 1_000_000;
const OPTIONS = Object.freeze({ target: 3 });

/**
 * A room component over the in-memory store. `kept` lists the finished games handed to `keepFinishedGame`, and
 * `failKeeping` makes the next ones fail, as a database blip would.
 */
function setup() {
  const published = [];
  const kept = [];
  const control = { failKeeping: 0 };
  const codes = ["ROOM22", "ROOM33"];
  const rooms = createRoomComponent({
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry([raceEngine]),
    events: { emit: (event, payload) => published.push({ event, payload }) },
    generateCode: () => codes.shift(),
    generateSeed: () => 42, // Bob moves first
    keepFinishedGame: async (game) => {
      if (control.failKeeping > 0) {
        control.failKeeping -= 1;
        throw new Error("db blip");
      }
      kept.push(game);
    },
  });
  /** Alice beats Bob in a new room. Answers the room's code and the game as its finish announced it. */
  const finishedGame = async () => {
    const { code } = await rooms.createRoom({
      network: "n",
      host: ALICE,
      gameId: "race",
      options: OPTIONS,
      now: T0,
    });
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });
    await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
    await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 3 });
    const announced = published.findLast(({ event }) => event === ROOM_EVENTS.GAME_FINISHED).payload;
    return { code, announced };
  };
  return { rooms, kept, control, finishedGame };
}

describe("roomComponent.listFinishedGames (CC-111)", () => {
  it("lists the game of every finished room, as the finish announced it, and nothing else", async () => {
    const { rooms, finishedGame } = setup();
    const { announced } = await finishedGame();
    await rooms.createRoom({ network: "n", host: ALICE, gameId: "race", options: OPTIONS, now: T0 });

    expect(await rooms.listFinishedGames()).toEqual([announced]);
  });
});

describe("roomComponent: a finished game is kept before its room changes (CC-111)", () => {
  it("keeps the game before a rematch replaces it", async () => {
    const { rooms, kept, finishedGame } = setup();
    const { code, announced } = await finishedGame();

    await rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 4 });
    await rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 5 });

    expect(kept[0]).toEqual(announced);
    expect(new Set(kept.map(({ room }) => room.game.matchId))).toEqual(
      new Set([announced.room.game.matchId]),
    );
  });

  it("keeps the game before the room closes because everyone left", async () => {
    const { rooms, kept, finishedGame } = setup();
    const { code, announced } = await finishedGame();
    await rooms.leaveRoom({ code, playerId: ALICE.id, now: T0 + 4 });

    const result = await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 5 });

    expect(result).toEqual({ closed: true });
    expect(kept[0]).toEqual(announced);
  });

  it("keeps the game before the sweep closes the room when the rematch window ends", async () => {
    const { rooms, kept, finishedGame } = setup();
    const { announced } = await finishedGame();

    const closed = await rooms.sweepExpired({ now: T0 + 3 + ROOM_LIFETIMES.rematchWindowMs });

    expect(closed).toHaveLength(1);
    expect(kept).toEqual([announced]);
  });

  it("refuses the change while the game cannot be kept, so the game stays in its room", async () => {
    const { rooms, kept, control, finishedGame } = setup();
    const { code, announced } = await finishedGame();
    await rooms.requestRematch({ code, playerId: ALICE.id, now: T0 + 4 });
    control.failKeeping = 1;

    await expect(rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 5 })).rejects.toThrow("db blip");
    const still = await rooms.getRoom(code);
    const rematch = await rooms.requestRematch({ code, playerId: BOB.id, now: T0 + 6 });

    expect(still.status).toBe("finished");
    expect(still.game.matchId).toBe(announced.room.game.matchId);
    expect(rematch.status).toBe("playing");
    expect(kept.at(-1).room.game.matchId).toBe(announced.room.game.matchId);
  });

  it("keeps nothing for rooms whose game has not finished", async () => {
    const { rooms, kept } = setup();
    const { code } = await rooms.createRoom({
      network: "n",
      host: ALICE,
      gameId: "race",
      options: OPTIONS,
      now: T0,
    });
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });
    await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 2 });

    expect(kept).toEqual([]);
  });
});
