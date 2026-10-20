import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { TEST_SEAT_IDS } from "../../testing/seatIds.js";
import { createRoomComponent } from "./roomComponent.js";

// CC-034: the avatar a person picked is kept on their seat when they sit down, and every view shows it beside the
// name. A computer character and a deleted player's stand-in never have one.
const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const ACCOUNT = Object.freeze({
  kind: "user",
  id: "user_0123456789abcdef01234567",
  displayName: "AliceTest",
});
const PIP = Object.freeze({
  kind: "bot",
  id: "bot_pip_easy",
  displayName: "Pip",
  bot: Object.freeze({ character: "pip", level: "easy" }),
});
const T0 = 1_000_000;

function setup(picked = {}) {
  const asked = [];
  const avatars = {
    avatarOf: async ({ playerId }) => {
      asked.push(playerId);
      return picked[playerId];
    },
  };
  const roomDao = createInMemoryRoomDao();
  const rooms = createRoomComponent({
    seatIds: TEST_SEAT_IDS,
    roomAccessor: createRoomAccessor({ roomDao }),
    engines: createEngineRegistry([raceEngine]),
    events: { emit() {} },
    generateCode: () => "ROOM01",
    generateSeed: () => 42,
    avatars,
  });
  const open = async (host) =>
    (await rooms.createRoom({ network: "net-a", host, gameId: "race", options: { target: 3 }, now: T0 }))
      .code;
  return { rooms, open, asked };
}

const seatsOf = (view) => view.seats.map(({ displayName, avatar }) => ({ displayName, avatar }));

describe("roomComponent: avatars on seats (CC-034)", () => {
  it("keeps each person's avatar on their seat and shows it to everyone in the room", async () => {
    const { rooms, open } = setup({ [ALICE.id]: "rocket", [BOB.id]: "owl" });
    const code = await open(ALICE);
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });
    const room = await rooms.getRoom(code);

    expect(room.seats.map((seat) => seat.avatar)).toEqual(["rocket", "owl"]);
    for (const viewer of [ALICE.id, BOB.id, "someone_watching"]) {
      expect(seatsOf(rooms.viewFor(room, viewer))).toEqual([
        { displayName: "Alice", avatar: "rocket" },
        { displayName: "Bob", avatar: "owl" },
      ]);
    }
  });

  it("leaves the avatar out for a person who never picked one", async () => {
    const { rooms, open } = setup({ [BOB.id]: "owl" });
    const code = await open(ALICE);
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });
    const room = await rooms.getRoom(code);

    expect(room.seats[0]).not.toHaveProperty("avatar");
    expect(rooms.viewFor(room, BOB.id).seats[0]).not.toHaveProperty("avatar");
  });

  it("never asks about a computer character, which is drawn from its own art", async () => {
    const { rooms, open, asked } = setup({ [PIP.id]: "rocket" });
    const code = await open(ALICE);

    await rooms.joinRoom({ code, player: PIP, now: T0 + 1 });

    expect(asked).toEqual([ALICE.id]);
    expect((await rooms.getRoom(code)).seats[1]).not.toHaveProperty("avatar");
  });

  it("shows only avatars still in the catalogue, whatever a stored seat holds", async () => {
    const { rooms, open } = setup({ [ALICE.id]: "<script>" });
    const code = await open(ALICE);
    const room = await rooms.getRoom(code);

    expect(rooms.viewFor(room, ALICE.id).seats[0]).not.toHaveProperty("avatar");
  });

  it("keeps the avatar on the seat of a guest who signs in", async () => {
    const { rooms, open } = setup({ [ALICE.id]: "rocket" });
    const code = await open(ALICE);

    await rooms.transferPlayer({ from: ALICE.id, to: ACCOUNT, now: T0 + 1 });

    expect((await rooms.getRoom(code)).seats[0]).toMatchObject({ playerId: ACCOUNT.id, avatar: "rocket" });
  });

  it("gives a deleted player's stand-in no avatar", async () => {
    const { rooms, open } = setup({ [ALICE.id]: "rocket", [BOB.id]: "owl" });
    const code = await open(ALICE);
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });
    const standIn = () => ({ id: "deleted_1", displayName: "Deleted player" });

    const [room] = await rooms.erasePlayer({ playerId: ALICE.id, standIn, now: T0 + 2 });

    expect(room.code).toBe(code);
    expect(room.seats.find((seat) => seat.playerId === "deleted_1")).not.toHaveProperty("avatar");
  });

  it("refuses an avatar source that cannot answer", () => {
    expect(() =>
      createRoomComponent({
        seatIds: TEST_SEAT_IDS,
        roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
        engines: createEngineRegistry([raceEngine]),
        events: { emit() {} },
        avatars: {},
      }),
    ).toThrow(/avatars.avatarOf/);
  });
});
