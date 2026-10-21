import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { TEST_SEAT_IDS } from "../../testing/seatIds.js";
import { createRoomComponent, ROOM_EVENTS } from "./roomComponent.js";

// CC-044, ADR-071.6: when the owner renames a reported account, its seats in open rooms take the new name at once, so
// the others in the room stop seeing the old one and a game that ends later records the new one (review of #150).
const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const RUDE = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "RudeName" });
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

const namesIn = (room) => room.seats.map((seat) => seat.displayName);

describe("roomComponent.renamePlayer (CC-044)", () => {
  it("gives the player's seat the new name in every open room, tells each room, and leaves other seats alone", async () => {
    const { rooms, open, emitted } = setup();
    const waiting = await open(RUDE);
    const playing = await open(ALICE);
    await rooms.joinRoom({ code: playing, player: RUDE, now: T0 + 1 });
    const other = await open(ALICE);
    emitted.length = 0;

    const changed = await rooms.renamePlayer({
      playerId: RUDE.id,
      displayName: "Player_ABCDEF",
      now: T0 + 2,
    });

    expect(changed.map((room) => room.code).sort()).toEqual([playing, waiting].sort());
    expect(namesIn(await rooms.getRoom(waiting))).toEqual(["Player_ABCDEF"]);
    expect(namesIn(await rooms.getRoom(playing))).toEqual(["Alice", "Player_ABCDEF"]);
    expect(namesIn(await rooms.getRoom(other))).toEqual(["Alice"]);
    expect(
      emitted
        .filter((e) => e.name === ROOM_EVENTS.UPDATED)
        .map((e) => e.payload.room.code)
        .sort(),
    ).toEqual([playing, waiting].sort());
  });

  it("records the new name for a game that ends after the rename", async () => {
    const { rooms, open, emitted } = setup();
    const code = await open(ALICE);
    await rooms.joinRoom({ code, player: RUDE, now: T0 + 1 });

    await rooms.renamePlayer({ playerId: RUDE.id, displayName: "Player_ABCDEF", now: T0 + 2 });
    await rooms.makeMove({ code, playerId: RUDE.id, move: { add: 1 }, now: T0 + 3 });
    await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 4 });

    const finished = emitted
      .filter((e) => e.name === ROOM_EVENTS.GAME_FINISHED)
      .map((e) => namesIn(e.payload.room));
    expect(finished).toEqual([["Alice", "Player_ABCDEF"]]);
  });

  it("changes nothing for a player in no room, or already under that name", async () => {
    const { rooms, open } = setup();
    await open(ALICE);

    expect(await rooms.renamePlayer({ playerId: RUDE.id, displayName: "Player_ABCDEF", now: T0 })).toEqual(
      [],
    );
    expect(await rooms.renamePlayer({ playerId: ALICE.id, displayName: "Alice", now: T0 })).toEqual([]);
  });
});
