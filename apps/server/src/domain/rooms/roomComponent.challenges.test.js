import { describe, expect, it } from "vitest";
import { PRESENCE, ROOM_STATUS } from "@classicade/shared";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { TEST_SEAT_IDS } from "../../testing/seatIds.js";
import { ConflictError, ValidationError } from "../../utils/errors.js";
import { createRoomComponent } from "./roomComponent.js";

// CC-139: the room of a challenge someone took has both players seated, and the game starts once both have its
// page open.
const ALICE = Object.freeze({ id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const T0 = 1_000_000;

function setup({ limits } = {}) {
  const rooms = createRoomComponent({
    seatIds: TEST_SEAT_IDS,
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry([raceEngine]),
    events: { emit() {} },
    generateSeed: () => 42,
    avatars: { avatarOf: async ({ playerId }) => (playerId === ALICE.id ? "rocket" : undefined) },
    ...(limits && { limits }),
  });
  const make = (fields = {}) =>
    rooms.createChallengeRoom({
      challenger: ALICE,
      accepter: BOB,
      network: "net-b",
      gameId: "race",
      options: { target: 3 },
      now: T0,
      ...fields,
    });
  return { rooms, make };
}

describe("roomComponent.createChallengeRoom (CC-139)", () => {
  it("seats the challenger first as host and offline, and the player who took it as away", async () => {
    const { make } = setup();

    const room = await make();

    expect(room).toMatchObject({
      gameId: "race",
      options: { target: 3 },
      status: ROOM_STATUS.WAITING,
      hostId: ALICE.id,
      network: "net-b",
    });
    expect(room.seats).toEqual([
      {
        playerId: ALICE.id,
        displayName: "Alice",
        avatar: "rocket",
        connected: false,
        away: false,
        since: T0,
      },
      { playerId: BOB.id, displayName: "Bob", connected: false, away: true, since: T0 },
    ]);
  });

  it("starts the game only when both players have the room page open", async () => {
    const { rooms, make } = setup();
    const { code } = await make();

    const bobHere = await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });
    expect(bobHere.status).toBe(ROOM_STATUS.WAITING);
    expect(rooms.viewFor(bobHere, BOB.id).seats.map((seat) => seat.presence)).toEqual([
      PRESENCE.OFFLINE,
      PRESENCE.HERE,
    ]);

    const both = await rooms.joinRoom({ code, player: { kind: "guest", ...ALICE }, now: T0 + 2 });
    expect(both.status).toBe(ROOM_STATUS.PLAYING);
  });

  it("shows the challenger as away once their browser is on the site", async () => {
    const { rooms, make } = setup();
    const { code } = await make();

    await rooms.playerOnline({ playerId: ALICE.id, now: T0 + 1 });

    expect((await rooms.getRoom(code)).seats[0]).toMatchObject({ connected: false, away: true });
  });

  it("refuses a third player with the full room answer", async () => {
    const { rooms, make } = setup();
    const { code } = await make();

    await expect(
      rooms.joinRoom({ code, player: { kind: "guest", id: "guest_c", displayName: "Cara" }, now: T0 + 1 }),
    ).rejects.toThrow("This room is full");
  });

  it("checks the game and its options like any new room", async () => {
    const { make } = setup();

    await expect(make({ gameId: "ludo" })).rejects.toThrow(ValidationError);
    await expect(make({ options: { target: "lots" } })).rejects.toThrow(ValidationError);
    await expect(make({ network: "" })).rejects.toThrow(TypeError);
    await expect(make({ earlierNetworks: [""] })).rejects.toThrow(TypeError);
  });

  it("checks a game's options for a challenge the same way, and answers them as the engine accepts them", () => {
    const { rooms } = setup();

    expect(rooms.checkOptions({ gameId: "race", options: { target: 3 } })).toEqual({ target: 3 });
    expect(() => rooms.checkOptions({ gameId: "ludo", options: {} })).toThrow(ValidationError);
  });

  it("counts against the waiting rooms of the player who took it", async () => {
    const { make } = setup({
      limits: { waitingRoomsPerPlayer: 1, openRoomsPerAddress: 50, openRoomsMax: 50 },
    });
    await make();

    await expect(make()).rejects.toThrow(ConflictError);
  });
});
