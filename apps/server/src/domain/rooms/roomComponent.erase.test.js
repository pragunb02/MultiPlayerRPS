import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { createRoomComponent, ROOM_EVENTS } from "./roomComponent.js";
import { TEST_SEAT_IDS } from "../../testing/seatIds.js";

const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const CAROL = Object.freeze({ kind: "guest", id: "guest_c", displayName: "Carol" });
const T0 = 1_000_000;

function setup() {
  const published = [];
  const queue = ["ROOM22", "ROOM33", "ROOM44"];
  const rooms = createRoomComponent({
    seatIds: TEST_SEAT_IDS,
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry([raceEngine]),
    events: { emit: (event, payload) => event !== ROOM_EVENTS.CHANGED && published.push({ event, payload }) },
    generateCode: () => queue.shift(),
    generateSeed: () => 42,
  });
  let stands = 0;
  const standIn = () => ({ id: `deleted_${++stands}`, displayName: "Deleted player" });
  return { rooms, published, standIn };
}

const createRace = (rooms, host = ALICE) =>
  rooms.createRoom({ network: "net-a", host, gameId: "race", options: { target: 3 }, now: T0 });

describe("roomComponent.erasePlayer (an account is deleted, CC-035)", () => {
  it("forfeits a running game for a stand-in, so the other player wins and nothing names the player", async () => {
    const { rooms, published, standIn } = setup();
    const { code } = await createRace(rooms);
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });

    const [room] = await rooms.erasePlayer({ playerId: ALICE.id, standIn, now: T0 + 2 });

    expect(room.status).toBe("finished");
    expect(room.result).toEqual(expect.objectContaining({ winners: [BOB.id], reason: "forfeit" }));
    expect(room.seats).toEqual([
      expect.objectContaining({ playerId: "deleted_1", displayName: "Deleted player", connected: false }),
      expect.objectContaining({ playerId: BOB.id, displayName: "Bob", connected: true }),
    ]);
    expect(room.rematch.available).toBe(false);
    expect(JSON.stringify(room)).not.toContain(ALICE.id);
    const finished = published.find((p) => p.event === ROOM_EVENTS.GAME_FINISHED);
    expect(finished.payload.room.seats.map((seat) => seat.playerId)).toEqual(["deleted_1", BOB.id]);
    expect(JSON.stringify(finished.payload.room)).not.toContain(ALICE.id);
  });

  it("closes a waiting room the player was alone in, and touches nobody else's rooms", async () => {
    const { rooms, published, standIn } = setup();
    const { code } = await createRace(rooms);
    const other = await createRace(rooms, CAROL);

    expect(await rooms.erasePlayer({ playerId: ALICE.id, standIn, now: T0 + 1 })).toEqual([]);

    expect(published).toContainEqual({ event: ROOM_EVENTS.CLOSED, payload: { code, reason: "empty" } });
    expect((await rooms.getRoom(other.code)).seats.map((seat) => seat.playerId)).toEqual([CAROL.id]);
  });

  it("changes nothing for a player who sits nowhere", async () => {
    const { rooms, standIn } = setup();
    await createRace(rooms, CAROL);

    expect(await rooms.erasePlayer({ playerId: ALICE.id, standIn, now: T0 + 1 })).toEqual([]);
  });
});
