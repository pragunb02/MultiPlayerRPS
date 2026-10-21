import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { ROOM_END_REASONS, ROOM_STATUS } from "@classicade/shared";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { TEST_SEAT_IDS } from "../../testing/seatIds.js";
import { createRoomComponent, ROOM_EVENTS } from "./roomComponent.js";

// CC-334, ADR-078 decision 4: a suspended account leaves every open room as itself, exactly as a player who leaves.
// No stand-in: the room keeps the name it showed, so nothing tells the opponent (who may have reported) why.
const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Bob" });
const T0 = 1_000_000;

function setup() {
  let code = 0;
  const emitted = [];
  const rooms = createRoomComponent({
    seatIds: TEST_SEAT_IDS,
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry([raceEngine]),
    events: { emit: (name, payload) => emitted.push({ name, payload }) },
    generateCode: () => `ROOM${String(++code).padStart(2, "0")}`,
    generateSeed: () => 42,
  });
  const open = async (host) =>
    (await rooms.createRoom({ network: "net-a", host, gameId: "race", options: { target: 3 }, now: T0 }))
      .code;
  return { rooms, open, emitted };
}

describe("roomComponent.removePlayer (CC-334)", () => {
  it("takes the player out of every open room as a leave: a running game is forfeited, a waiting seat is given up", async () => {
    const { rooms, open, emitted } = setup();
    const playing = await open(ALICE);
    await rooms.joinRoom({ code: playing, player: BOB, now: T0 + 1 });
    const hostedAlone = await open(BOB);
    const others = await open(ALICE);
    emitted.length = 0;

    const changed = await rooms.removePlayer({ playerId: BOB.id, now: T0 + 3 });

    const forfeited = await rooms.getRoom(playing);
    expect(forfeited.status).toBe(ROOM_STATUS.FINISHED);
    expect(forfeited.result).toMatchObject({ winners: [ALICE.id], reason: ROOM_END_REASONS.FORFEIT });
    // The seat keeps the player's own id and name, as after any leave: no stand-in, nothing to tell.
    expect(forfeited.seats.map((seat) => [seat.playerId, seat.displayName])).toEqual([
      [ALICE.id, "Alice"],
      [BOB.id, "Bob"],
    ]);
    const finished = emitted.filter((e) => e.name === ROOM_EVENTS.GAME_FINISHED);
    expect(finished.map((e) => e.payload.room.code)).toEqual([playing]);
    // A waiting room the player was alone in closes, as when they leave it.
    await expect(rooms.getRoom(hostedAlone)).rejects.toThrow();
    expect((await rooms.getRoom(others)).seats.map((seat) => seat.playerId)).toEqual([ALICE.id]);
    expect(changed.map((room) => room.code)).toEqual([playing]);
    expect(emitted.filter((e) => e.name === ROOM_EVENTS.UPDATED).map((e) => e.payload.room.code)).toEqual([
      playing,
    ]);
  });

  it("leaves a finished room as anyone leaves it, and the room keeps their name for the rematch line", async () => {
    const { rooms, open } = setup();
    const code = await open(ALICE);
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });
    await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
    await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 2 });
    expect((await rooms.getRoom(code)).status).toBe(ROOM_STATUS.FINISHED);

    const changed = await rooms.removePlayer({ playerId: BOB.id, now: T0 + 3 });

    const room = await rooms.getRoom(code);
    expect(room.seats.map((seat) => seat.playerId)).toEqual([ALICE.id]);
    expect(room.rematch).toMatchObject({ leftName: "Bob" });
    expect(changed.map((each) => each.code)).toEqual([code]);
  });

  it("changes nothing for a player in no room", async () => {
    const { rooms, open } = setup();
    await open(ALICE);

    expect(await rooms.removePlayer({ playerId: BOB.id, now: T0 })).toEqual([]);
  });
});
